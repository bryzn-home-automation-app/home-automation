package com.homeplatform.controller;

import com.homeplatform.model.AppEvent;
import com.homeplatform.service.AppEventService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.sql.DataSource;
import java.lang.management.ManagementFactory;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/admin")
public class AdminDebugController {

    private final AppEventService appEventService;
    private final DataSource dataSource;
    private static final Set<String> SENSITIVE_COLUMNS = Set.of(
            "password_hash", "password", "token", "secret", "jwt_secret",
            "salt", "api_key", "access_token", "refresh_token"
    );

    public AdminDebugController(AppEventService appEventService, DataSource dataSource) {
        this.appEventService = appEventService;
        this.dataSource = dataSource;
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
}
