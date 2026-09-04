package com.homeplatform.controller;

import com.homeplatform.dto.SyncRangeRequest;
import com.homeplatform.model.AppEvent;
import com.homeplatform.service.AlertEngine;
import com.homeplatform.service.AppEventService;
import com.homeplatform.service.DailySyncScheduler;
import com.homeplatform.service.ForecastScheduler;
import com.homeplatform.service.HourlySyncScheduler;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.sql.DataSource;
import java.lang.management.ManagementFactory;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/admin")
public class AdminDebugController {

    private static final Logger log = LoggerFactory.getLogger(AdminDebugController.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    /** CoServ only retains ~2 weeks of interval data. */
    private static final int MAX_RANGE_DAYS = 14;
    /** Mirrors HourlySyncScheduler — a day is "complete" at this many non-zero hours. */
    private static final int HOURLY_COMPLETE_THRESHOLD = 20;
    private static final int HOURLY_EXPECTED = 24;

    // Config values, mirrored from ConfigController so the config-check panel can
    // validate them. Never exposes secrets — only presence/booleans and non-sensitive rates.
    @Value("${app.kwh-rate:0.12}")           private double kwhRate;
    @Value("${app.gas-unit-rate:1.47}")      private double gasUnitRate;
    @Value("${app.data-start-date:07/24/2026}") private String dataStartDate;
    @Value("${app.property-latitude:0}")     private double propertyLatitude;
    @Value("${app.property-longitude:0}")    private double propertyLongitude;

    private final AppEventService appEventService;
    private final DataSource dataSource;
    private final DailySyncScheduler dailySyncScheduler;
    private final HourlySyncScheduler hourlySyncScheduler;
    private final AlertEngine alertEngine;
    private final ForecastScheduler forecastScheduler;
    /** Single-threaded so manual daily + hourly syncs serialize (no overlapping browser logins). */
    private final ExecutorService syncExecutor = Executors.newSingleThreadExecutor();
    private static final Set<String> SENSITIVE_COLUMNS = Set.of(
            "password_hash", "password", "token", "secret", "jwt_secret",
            "salt", "api_key", "access_token", "refresh_token"
    );

    public AdminDebugController(AppEventService appEventService, DataSource dataSource,
                                DailySyncScheduler dailySyncScheduler,
                                HourlySyncScheduler hourlySyncScheduler,
                                AlertEngine alertEngine,
                                ForecastScheduler forecastScheduler) {
        this.appEventService = appEventService;
        this.dataSource = dataSource;
        this.dailySyncScheduler = dailySyncScheduler;
        this.hourlySyncScheduler = hourlySyncScheduler;
        this.alertEngine = alertEngine;
        this.forecastScheduler = forecastScheduler;
    }

    /** Require ADMIN role — mirrors AdminController pattern. */
    private void requireAdmin(HttpServletRequest request) {
        String role = (String) request.getAttribute("role");
        if (!"ADMIN".equals(role)) {
            throw new SecurityException("Admin access required");
        }
    }

    @GetMapping("/events")
    public ResponseEntity<List<AppEvent>> getEvents(
            HttpServletRequest request,
            @RequestParam(defaultValue = "24") int hours,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String level,
            @RequestParam(defaultValue = "200") int limit) {
        requireAdmin(request);
        List<AppEvent> events = appEventService.getRecent(hours, category, level);
        if (events.size() > limit) events = events.subList(0, limit);
        return ResponseEntity.ok(events);
    }

    @GetMapping("/events/summary")
    public ResponseEntity<Map<String, Object>> getEventSummary(HttpServletRequest request) {
        requireAdmin(request);
        List<AppEvent> recent = appEventService.getRecent(24, null, null);
        long errors = recent.stream().filter(e -> "ERROR".equals(e.getLevel())).count();
        long warns = recent.stream().filter(e -> "WARN".equals(e.getLevel())).count();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("total24h", recent.size());
        summary.put("errors24h", errors);
        summary.put("warns24h", warns);
        summary.put("timestamp", LocalDateTime.now().toString());
        return ResponseEntity.ok(summary);
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> getHealth(HttpServletRequest request) {
        requireAdmin(request);

        Map<String, Object> health = new LinkedHashMap<>();
        health.put("timestamp", LocalDateTime.now().toString());

        // DB status
        try (Connection conn = dataSource.getConnection()) {
            health.put("database", Map.of("status", "UP", "url", conn.getMetaData().getURL()));
        } catch (Exception e) {
            health.put("database", Map.of("status", "DOWN", "error", e.getMessage()));
        }

        // JVM info
        var runtime = ManagementFactory.getRuntimeMXBean();
        var memory = ManagementFactory.getMemoryMXBean();
        long uptimeMinutes = runtime.getUptime() / 60_000;
        long heapUsedMB = memory.getHeapMemoryUsage().getUsed() / (1024 * 1024);
        long heapMaxMB = memory.getHeapMemoryUsage().getMax() / (1024 * 1024);

        health.put("jvm", Map.of(
                "uptimeMinutes", uptimeMinutes,
                "heapUsedMB", heapUsedMB,
                "heapMaxMB", heapMaxMB,
                "startTime", new Date(runtime.getStartTime()).toString()
        ));

        health.put("threads", ManagementFactory.getThreadMXBean().getThreadCount());

        // Connection pool (HikariCP) — pool exhaustion is the classic "everything
        // hangs" failure and is invisible from the single-connection DB status check above.
        if (dataSource instanceof HikariDataSource hds) {
            try {
                HikariPoolMXBean pool = hds.getHikariPoolMXBean();
                health.put("pool", Map.of(
                        "active", pool.getActiveConnections(),
                        "idle", pool.getIdleConnections(),
                        "total", pool.getTotalConnections(),
                        "awaitingConnection", pool.getThreadsAwaitingConnection(),
                        "max", hds.getMaximumPoolSize()
                ));
            } catch (Exception ignored) {}
        }

        // Last sync check timestamp
        try (Connection conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                 "SELECT timestamp, message FROM app_events WHERE category = 'sync' AND source = 'HourlySyncScheduler' ORDER BY timestamp DESC LIMIT 1")) {
            var rs = stmt.executeQuery();
            if (rs.next()) {
                health.put("lastSyncCheck", Map.of(
                    "timestamp", rs.getTimestamp(1).toString(),
                    "message", rs.getString(2)
                ));
            }
        } catch (Exception ignored) {}

        return ResponseEntity.ok(health);
    }

    @GetMapping("/db/tables")
    public ResponseEntity<List<Map<String, Object>>> getTables(HttpServletRequest request) {
        requireAdmin(request);
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            ResultSet rs = stmt.executeQuery(
                "SELECT table_schema, table_name, " +
                "pg_size_pretty(pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name))) AS size, " +
                "(SELECT count(*) FROM information_schema.columns WHERE table_schema = t.table_schema AND table_name = t.table_name) AS cols " +
                "FROM information_schema.tables t " +
                "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
                "ORDER BY pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) DESC"
            );

            List<Map<String, Object>> tables = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("schema", rs.getString("table_schema"));
                row.put("name", rs.getString("table_name"));
                row.put("size", rs.getString("size"));
                row.put("columns", rs.getInt("cols"));
                tables.add(row);
            }
            return ResponseEntity.ok(tables);
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(List.of(Map.of("error", e.getMessage())));
        }
    }

    @GetMapping("/db/stats")
    public ResponseEntity<Map<String, Object>> getDbStats(HttpServletRequest request) {
        requireAdmin(request);
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            Map<String, Object> stats = new LinkedHashMap<>();

            // Row counts for key tables
            String[] tables = {"electric_usage", "hourly_electric_usage", "gas_usage",
                    "weather_observations", "app_events", "users", "guest_sessions", "notifications"};
            Map<String, Long> counts = new LinkedHashMap<>();
            for (String table : tables) {
                try {
                    ResultSet rs = stmt.executeQuery("SELECT count(*) FROM " + table);
                    rs.next();
                    counts.put(table, rs.getLong(1));
                } catch (Exception e) {
                    counts.put(table, -1L);
                }
            }
            stats.put("rowCounts", counts);

            // DB size
            ResultSet rs = stmt.executeQuery("SELECT pg_database_size(current_database())");
            rs.next();
            stats.put("dbSizeBytes", rs.getLong(1));

            rs = stmt.executeQuery("SELECT pg_size_pretty(pg_database_size(current_database()))");
            rs.next();
            stats.put("dbSizePretty", rs.getString(1));

            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/db/query")
    public ResponseEntity<Map<String, Object>> executeQuery(
            HttpServletRequest request,
            @RequestBody Map<String, String> body) {
        requireAdmin(request);

        String sql = body.get("query");
        if (sql == null || sql.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Query is required"));
        }

        String trimmed = sql.trim().toUpperCase();
        if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH") &&
                !trimmed.startsWith("EXPLAIN") && !trimmed.startsWith("SHOW")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Only SELECT, WITH, EXPLAIN, and SHOW queries are allowed"));
        }

        if (trimmed.contains("DROP") || trimmed.contains("DELETE") ||
                trimmed.contains("UPDATE") || trimmed.contains("INSERT") ||
                trimmed.contains("ALTER") || trimmed.contains("CREATE") ||
                trimmed.contains("TRUNCATE") || trimmed.contains("GRANT")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Write operations are not allowed through this interface"));
        }

        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {

            stmt.setQueryTimeout(30);
            boolean hasResult = stmt.execute(sql);

            if (hasResult) {
                ResultSet rs = stmt.getResultSet();
                ResultSetMetaData meta = rs.getMetaData();
                int colCount = meta.getColumnCount();

                // Build column headers
                List<String> columns = new ArrayList<>();
                for (int i = 1; i <= colCount; i++) {
                    columns.add(meta.getColumnName(i));
                }

                // Build rows, redacting sensitive columns
                List<List<Object>> rows = new ArrayList<>();
                int maxRows = 200;
                while (rs.next() && rows.size() < maxRows) {
                    List<Object> row = new ArrayList<>();
                    for (int i = 1; i <= colCount; i++) {
                        String colName = meta.getColumnName(i).toLowerCase();
                        if (SENSITIVE_COLUMNS.contains(colName) ||
                                (colName.contains("password") || colName.contains("secret") ||
                                 colName.contains("token") || colName.contains("hash"))) {
                            row.add("***REDACTED***");
                        } else {
                            Object val = rs.getObject(i);
                            row.add(val != null ? val.toString() : null);
                        }
                    }
                    rows.add(row);
                }

                Map<String, Object> result = new LinkedHashMap<>();
                result.put("columns", columns);
                result.put("rows", rows);
                result.put("rowCount", rows.size());
                if (rows.size() >= maxRows) {
                    result.put("truncated", true);
                }
                return ResponseEntity.ok(result);
            } else {
                int updateCount = stmt.getUpdateCount();
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("columns", List.of("affected_rows"));
                result.put("rows", List.of(List.of(String.valueOf(updateCount))));
                result.put("rowCount", 1);
                return ResponseEntity.ok(result);
            }
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /** Manually trigger the daily sync. Optional body carries a date range. */
    @PostMapping("/sync/daily")
    public ResponseEntity<Map<String, Object>> triggerDailySync(
            HttpServletRequest request,
            @RequestBody(required = false) SyncRangeRequest body) {
        requireAdmin(request);
        try {
            SyncRange range = resolveRange(body);
            syncExecutor.submit(() -> {
                try {
                    if (range == null) dailySyncScheduler.runDailySync();
                    else dailySyncScheduler.runSyncForRange(range.start(), range.end());
                } catch (Exception e) {
                    log.error("Manual daily sync failed", e);
                }
            });
            return ResponseEntity.ok(triggered("daily", range));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Manually trigger the hourly average-usage sync. Optional body carries a date range. */
    @PostMapping("/sync/hourly")
    public ResponseEntity<Map<String, Object>> triggerHourlySync(
            HttpServletRequest request,
            @RequestBody(required = false) SyncRangeRequest body) {
        requireAdmin(request);
        try {
            SyncRange range = resolveRange(body);
            syncExecutor.submit(() -> {
                try {
                    if (range == null) hourlySyncScheduler.checkAndSync();
                    else hourlySyncScheduler.runSyncForRange(range.start(), range.end());
                } catch (Exception e) {
                    log.error("Manual hourly sync failed", e);
                }
            });
            return ResponseEntity.ok(triggered("hourly", range));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Manually generate alerts from current usage data. */
    @PostMapping("/sync/alerts")
    public ResponseEntity<Map<String, Object>> triggerAlerts(HttpServletRequest request) {
        requireAdmin(request);
        try {
            alertEngine.generateForAllUsers();
            return ResponseEntity.ok(Map.of("status", "triggered", "type", "alerts"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /** Manually retrain the forecast model and generate predictions. */
    @PostMapping("/sync/forecast")
    public ResponseEntity<Map<String, Object>> triggerForecast(HttpServletRequest request) {
        requireAdmin(request);
        try {
            forecastScheduler.runManualRetrain();
            return ResponseEntity.ok(Map.of("status", "triggered", "type", "forecast"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Per-granularity data freshness: how current the daily vs hourly electric
     * data is, plus the last sync attempt/success for each. The single
     * "lastSyncCheck" in {@code /health} can't distinguish "hourly is 3 days
     * stale" from "hourly checked 5 min ago and found nothing new".
     */
    @GetMapping("/sync/freshness")
    public ResponseEntity<Map<String, Object>> getSyncFreshness(HttpServletRequest request) {
        requireAdmin(request);
        try (Connection conn = dataSource.getConnection()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("daily", freshness(conn, "electric_usage", "DailySyncScheduler"));
            out.put("hourly", freshness(conn, "hourly_electric_usage", "HourlySyncScheduler"));
            out.put("timestamp", LocalDateTime.now().toString());
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /** Build a freshness block for one usage table + its scheduler source. */
    private Map<String, Object> freshness(Connection conn, String table, String source) throws Exception {
        Map<String, Object> m = new LinkedHashMap<>();
        // Data freshness — the ground truth of "how current is this table".
        try (var st = conn.prepareStatement("SELECT MAX(timestamp) FROM " + table)) {
            var rs = st.executeQuery();
            Timestamp ts = rs.next() ? rs.getTimestamp(1) : null;
            if (ts != null) {
                LocalDateTime dt = ts.toLocalDateTime();
                m.put("dataThrough", dt.toString());
                m.put("dataThroughDate", dt.toLocalDate().toString());
                m.put("ageHours", Duration.between(dt, LocalDateTime.now()).toHours());
            } else {
                m.put("dataThrough", null);
                m.put("dataThroughDate", null);
                m.put("ageHours", null);
            }
        }
        m.put("lastAttempt", latestEventTs(conn, source, null));
        m.put("lastSuccess", latestEventTs(conn, source, "INFO"));
        return m;
    }

    /** MAX(timestamp) of sync events for a source, optionally at a given level. */
    private String latestEventTs(Connection conn, String source, String level) throws Exception {
        String sql = "SELECT MAX(timestamp) FROM app_events WHERE category='sync' AND source=?"
                + (level != null ? " AND level=?" : "");
        try (var st = conn.prepareStatement(sql)) {
            st.setString(1, source);
            if (level != null) st.setString(2, level);
            var rs = st.executeQuery();
            Timestamp ts = rs.next() ? rs.getTimestamp(1) : null;
            return ts != null ? ts.toLocalDateTime().toString() : null;
        }
    }

    /**
     * Per-day coverage matrix for the last N days: daily row present, hourly
     * row count + non-zero count + completeness, and weather presence. Surfaces
     * exactly the gap information the schedulers compute internally and discard.
     */
    @GetMapping("/coverage")
    public ResponseEntity<Map<String, Object>> getCoverage(HttpServletRequest request,
            @RequestParam(defaultValue = "14") int days) {
        requireAdmin(request);
        int n = Math.max(1, Math.min(days, MAX_RANGE_DAYS));
        try (Connection conn = dataSource.getConnection()) {
            Set<LocalDate> dailyDates = new HashSet<>();
            try (var st = conn.prepareStatement(
                    "SELECT DISTINCT timestamp::date FROM electric_usage WHERE timestamp::date >= CURRENT_DATE - make_interval(days => ?)")) {
                st.setInt(1, n);
                var rs = st.executeQuery();
                while (rs.next()) dailyDates.add(rs.getDate(1).toLocalDate());
            }

            Map<LocalDate, int[]> hourly = new HashMap<>(); // date -> [rows, nonZero]
            try (var st = conn.prepareStatement(
                    "SELECT timestamp::date AS d, COUNT(*) AS rows, COUNT(*) FILTER (WHERE usage_kwh > 0) AS nz " +
                    "FROM hourly_electric_usage WHERE timestamp::date >= CURRENT_DATE - make_interval(days => ?) GROUP BY 1")) {
                st.setInt(1, n);
                var rs = st.executeQuery();
                while (rs.next()) hourly.put(rs.getDate("d").toLocalDate(), new int[]{rs.getInt("rows"), rs.getInt("nz")});
            }

            Set<LocalDate> wxDates = new HashSet<>();
            try (var st = conn.prepareStatement(
                    "SELECT DISTINCT observation_date FROM weather_observations WHERE observation_date >= CURRENT_DATE - make_interval(days => ?)")) {
                st.setInt(1, n);
                var rs = st.executeQuery();
                while (rs.next()) wxDates.add(rs.getDate(1).toLocalDate());
            }

            List<Map<String, Object>> rows = new ArrayList<>();
            LocalDate today = LocalDate.now(CHICAGO);
            for (int i = 0; i < n; i++) {
                LocalDate d = today.minusDays(i);
                int[] h = hourly.getOrDefault(d, new int[]{0, 0});
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("date", d.toString());
                row.put("dailyPresent", dailyDates.contains(d));
                row.put("hourlyRows", h[0]);
                row.put("hourlyNonZero", h[1]);
                row.put("hourlyComplete", h[1] >= HOURLY_COMPLETE_THRESHOLD);
                row.put("weatherPresent", wxDates.contains(d));
                rows.add(row);
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("days", n);
            out.put("expectedHourly", HOURLY_EXPECTED);
            out.put("completeThreshold", HOURLY_COMPLETE_THRESHOLD);
            out.put("coverage", rows);
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Sync outcome rollup over the last N days, grouped by scheduler source:
     * total runs and OK/WARN/ERROR counts + success rate. A trend the raw
     * "recent syncs" list can't show — catches a flaky login or CoServ outage.
     */
    @GetMapping("/sync/history")
    public ResponseEntity<Map<String, Object>> getSyncHistory(HttpServletRequest request,
            @RequestParam(defaultValue = "30") int days) {
        requireAdmin(request);
        int n = Math.max(1, Math.min(days, 90));
        try (Connection conn = dataSource.getConnection();
             var st = conn.prepareStatement(
                "SELECT source, COUNT(*) AS total, " +
                "COUNT(*) FILTER (WHERE level='INFO') AS ok, " +
                "COUNT(*) FILTER (WHERE level='WARN') AS warn, " +
                "COUNT(*) FILTER (WHERE level='ERROR') AS err, " +
                "MAX(timestamp) AS last_run " +
                "FROM app_events WHERE category='sync' AND timestamp >= NOW() - make_interval(days => ?) " +
                "GROUP BY source ORDER BY source")) {
            st.setInt(1, n);
            var rs = st.executeQuery();
            List<Map<String, Object>> bySource = new ArrayList<>();
            while (rs.next()) {
                long total = rs.getLong("total");
                long ok = rs.getLong("ok");
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("source", rs.getString("source"));
                m.put("total", total);
                m.put("ok", ok);
                m.put("warn", rs.getLong("warn"));
                m.put("error", rs.getLong("err"));
                m.put("successRate", total > 0 ? Math.round(ok * 1000.0 / total) / 10.0 : null);
                Timestamp last = rs.getTimestamp("last_run");
                m.put("lastRun", last != null ? last.toLocalDateTime().toString() : null);
                bySource.add(m);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("days", n);
            out.put("bySource", bySource);
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Config sanity checks — validates runtime config that otherwise only
     * reveals itself when something silently breaks (lat/long=0 → no weather,
     * missing CoServ creds → sync fails). Reports presence/booleans only,
     * never secret values.
     */
    @GetMapping("/config-check")
    public ResponseEntity<Map<String, Object>> getConfigCheck(HttpServletRequest request) {
        requireAdmin(request);
        List<Map<String, Object>> checks = new ArrayList<>();
        checks.add(check("kWh rate configured", kwhRate > 0, "$" + kwhRate + "/kWh"));
        checks.add(check("Gas unit rate configured", gasUnitRate > 0, "$" + gasUnitRate + "/unit"));
        boolean geoOk = propertyLatitude != 0 && propertyLongitude != 0;
        checks.add(check("Property lat/long set (weather)", geoOk,
                geoOk ? propertyLatitude + ", " + propertyLongitude : "0, 0 — weather cannot resolve"));
        checks.add(check("Data start date set", dataStartDate != null && !dataStartDate.isBlank(), dataStartDate));
        boolean cUser = notBlank(System.getenv("COSERV_USERNAME"));
        boolean cPass = notBlank(System.getenv("COSERV_PASSWORD"));
        checks.add(check("CoServ credentials present", cUser && cPass,
                (cUser ? "username set" : "username MISSING") + " · " + (cPass ? "password set" : "password MISSING")));
        return ResponseEntity.ok(Map.of("checks", checks));
    }

    private Map<String, Object> check(String name, boolean ok, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("check", name);
        m.put("status", ok ? "OK" : "WARN");
        m.put("detail", detail);
        return m;
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private Map<String, Object> triggered(String type, SyncRange range) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", "triggered");
        m.put("type", type);
        m.put("startDate", range == null ? "yesterday" : range.start());
        m.put("endDate", range == null ? "yesterday" : range.end());
        return m;
    }

    /**
     * Resolve an optional body into a validated date range, or {@code null}
     * for the default "yesterday". Throws {@link IllegalArgumentException} with
     * a user-facing message when the range is invalid.
     */
    private SyncRange resolveRange(SyncRangeRequest body) {
        if (body == null || (isBlank(body.getStartDate()) && isBlank(body.getEndDate()))) {
            return null;
        }
        String start = body.getStartDate();
        String end = body.getEndDate();
        if (isBlank(start) || isBlank(end)) {
            throw new IllegalArgumentException("Both startDate and endDate are required for a custom range");
        }
        LocalDate today = LocalDate.now(CHICAGO);
        LocalDate earliest = today.minusDays(MAX_RANGE_DAYS);
        LocalDate s, e;
        try {
            s = LocalDate.parse(start);
            e = LocalDate.parse(end);
        } catch (DateTimeParseException ex) {
            throw new IllegalArgumentException("Dates must be yyyy-MM-dd");
        }
        if (s.isAfter(e)) throw new IllegalArgumentException("startDate must be on or before endDate");
        if (e.isAfter(today)) throw new IllegalArgumentException("endDate cannot be in the future");
        if (s.isBefore(earliest)) throw new IllegalArgumentException(
                "startDate is more than " + MAX_RANGE_DAYS + " days ago — CoServ only keeps ~2 weeks");
        return new SyncRange(start, end);
    }

    private static boolean isBlank(String s) { return s == null || s.isBlank(); }

    /** Validated ISO date range. */
    private record SyncRange(String start, String end) {}
}
