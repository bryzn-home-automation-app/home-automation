package com.homeplatform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.HostHealthResponse;
import com.homeplatform.dto.HostHealthResponse.AppStats;
import com.homeplatform.dto.HostHealthResponse.Check;
import com.homeplatform.dto.HostHealthResponse.TableSize;
import com.homeplatform.dto.HostHistoryResponse;
import com.homeplatform.dto.HostSnapshot;
import com.homeplatform.dto.HostSnapshot.*;
import com.homeplatform.model.HostMetricSample;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.repository.HostMetricSampleRepository;
import com.homeplatform.repository.NotificationRepository;
import com.homeplatform.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NUC Health. scripts/host-metrics.ps1 runs on the NUC every minute and writes the host's
 * CPU, memory, disks, temperatures, network, power events and containers to
 * host-metrics/metrics.json, mounted here at /host-metrics. Each new sample's headline
 * numbers go to {@code host_metrics} (kept 90 days) for the charts; the full newest sample
 * stays in memory for the page.
 *
 * <p>Checks turn a sample into plain findings (a drive nearly full, Docker not answering,
 * running hot). Admins are notified when one holds for a few samples, and again daily while
 * it lasts; also when the NUC restarts, and when the monitor itself goes quiet.
 */
@Service
public class HostMetricsService {

    private static final Logger log = LoggerFactory.getLogger(HostMetricsService.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US);

    /** With no sample for this long, the monitor is offline. */
    static final Duration STALE = Duration.ofMinutes(5);
    /** ...and after this long the admins hear about it. */
    static final Duration STOPPED = Duration.ofMinutes(10);
    /** A pause this long between samples shows as a gap. */
    static final Duration GAP = Duration.ofMinutes(5);
    static final int RETENTION_DAYS = 90;
    /** One notification per problem per day, however long it lasts. */
    static final Duration REMIND_EVERY = Duration.ofHours(24);
    /** This app's own containers: one not running is a problem; the rest are just listed. */
    static final String OWN_CONTAINERS = "homeplatform-";

    static final String CRITICAL = "critical", WARNING = "warning";
    static final String TITLE_STOPPED = "NUC health monitor stopped";
    static final String TITLE_RESTARTED = "NUC restarted";

    /** Notify when a check of this key is critical (or warning too) for {@code samples} samples in a row. */
    record Rule(String title, int samples, boolean warningToo) {}

    static final Map<String, Rule> RULES = Map.of(
            "disk", new Rule("NUC drive almost full", 1, true),
            "memory", new Rule("NUC memory almost full", 5, false),
            "temperature", new Rule("NUC running hot", 3, false),
            "ssd", new Rule("NUC SSD problem", 1, true),
            "docker", new Rule("Docker on the NUC isn't responding", 3, false),
            "containers", new Rule("A HomeOS container stopped", 3, false));

    /** History ranges: how far back, and how much each point averages. */
    record Range(Duration span, Duration bucket) {}

    static final Map<String, Range> RANGES = Map.of(
            "24h", new Range(Duration.ofHours(24), Duration.ofMinutes(5)),
            "7d", new Range(Duration.ofDays(7), Duration.ofMinutes(30)),
            "30d", new Range(Duration.ofDays(30), Duration.ofHours(2)));

    private static final Pattern RESTART_BY = Pattern.compile("The process (.+?) \\(");
    private static final Pattern RESTART_REASON = Pattern.compile("for the following reason: (.+?) Reason Code");

    private final HostMetricSampleRepository samples;
    private final ObjectMapper mapper;
    private final Path file;
    private final Clock clock;
    private final NotificationService notificationService;
    private final NotificationRepository notifications;
    private final UserRepository users;
    private final JdbcTemplate jdbc;

    private volatile HostSnapshot latest;
    /** The newest stored sample, loaded from the database on first use. */
    private volatile HostMetricSample newest;
    private volatile boolean newestLoaded;
    private final Map<String, Integer> streaks = new ConcurrentHashMap<>();

    @Autowired
    public HostMetricsService(HostMetricSampleRepository samples, ObjectMapper mapper,
                              NotificationService notificationService, NotificationRepository notifications,
                              UserRepository users, JdbcTemplate jdbc,
                              @Value("${app.host-metrics.file:/host-metrics/metrics.json}") String file) {
        this(samples, mapper, Path.of(file), Clock.systemUTC(), notificationService, notifications, users, jdbc);
    }

    HostMetricsService(HostMetricSampleRepository samples, ObjectMapper mapper, Path file, Clock clock,
                       NotificationService notificationService, NotificationRepository notifications,
                       UserRepository users, JdbcTemplate jdbc) {
        this.samples = samples;
        this.mapper = mapper;
        this.file = file;
        this.clock = clock;
        this.notificationService = notificationService;
        this.notifications = notifications;
        this.users = users;
        this.jdbc = jdbc;
    }

    // ── Ingest ──

    /** Pick up the monitor's latest file. No file means it isn't set up on this host. */
    @Scheduled(initialDelay = 15_000, fixedDelay = 30_000)
    public void poll() {
        try {
            HostSnapshot s = mapper.readValue(Files.readAllBytes(file), HostSnapshot.class);
            if (s.collectedAt() != null && (latest == null || s.collectedAt().isAfter(latest.collectedAt()))) ingest(s);
        } catch (NoSuchFileException e) {
            // Not set up (or tests): nothing to do.
        } catch (Exception e) {
            log.warn("NUC health sample unreadable: {}", e.getMessage());
        }
    }

    /** Take one sample: keep it as the newest, store its numbers, and notify about what's wrong. */
    void ingest(HostSnapshot s) {
        Instant now = clock.instant();
        if (s.collectedAt().isAfter(now.plus(Duration.ofMinutes(2)))) {
            log.warn("NUC health sample from the future ({}); ignoring it", s.collectedAt());
            return;
        }
        latest = s;
        HostMetricSample previous = newest();
        if (previous == null || utc(s.collectedAt()).isAfter(previous.getCollectedAt())) {
            newest = samples.save(toSample(s));
            if (previous != null) noticeRestart(previous, s);
        }
        alert(checks(s, now));
    }

    static HostMetricSample toSample(HostSnapshot s) {
        Memory m = s.memory();
        Disk sys = systemDrive(s);
        Network net = s.network();
        Docker docker = s.docker();
        Long containersMem = docker == null || !Boolean.TRUE.equals(docker.ok()) ? null
                : list(docker.containers()).stream().map(Container::memBytes).filter(Objects::nonNull).mapToLong(Long::longValue).sum();
        return HostMetricSample.builder()
                .collectedAt(utc(s.collectedAt()))
                .cpuPct(s.cpu() == null ? null : s.cpu().usagePct())
                .memTotalBytes(m == null ? null : m.totalBytes())
                .memUsedBytes(m == null || m.totalBytes() == null || m.availableBytes() == null ? null : m.totalBytes() - m.availableBytes())
                .diskTotalBytes(sys == null ? null : sys.totalBytes())
                .diskFreeBytes(sys == null ? null : sys.freeBytes())
                .netRxBps(net == null ? null : net.rxBps())
                .netTxBps(net == null ? null : net.txBps())
                .cpuTempC(hottest(s))
                .diskTempC(list(s.physicalDisks()).stream().map(PhysicalDisk::temperatureC).filter(Objects::nonNull)
                        .max(Double::compare).orElse(null))
                .containersMemBytes(containersMem)
                .bootTime(s.host() == null || s.host().bootTime() == null ? null : utc(s.host().bootTime()))
                .build();
    }

    // ── Checks ──

    /** What's wrong in sample {@code s}, worst first. Empty when all is well (or there's no sample). */
    List<Check> checks(HostSnapshot s, Instant now) {
        List<Check> out = new ArrayList<>();
        if (s == null) return out;

        for (Disk d : list(s.disks())) {
            if (d.totalBytes() == null || d.totalBytes() <= 0 || d.freeBytes() == null) continue;
            double used = 100.0 * (d.totalBytes() - d.freeBytes()) / d.totalBytes();
            String detail = gb(d.freeBytes()) + " free of " + gb(d.totalBytes()) + ".";
            if (used >= 95) out.add(new Check("disk", CRITICAL, "Drive " + d.name() + " is almost full", detail));
            else if (used >= 85) out.add(new Check("disk", WARNING, "Drive " + d.name() + " is getting full", detail));
        }

        Memory m = s.memory();
        if (m != null && m.totalBytes() != null && m.totalBytes() > 0 && m.availableBytes() != null) {
            double used = 100.0 * (m.totalBytes() - m.availableBytes()) / m.totalBytes();
            String detail = gb(m.availableBytes()) + " of " + gb(m.totalBytes()) + " free.";
            if (used >= 95) out.add(new Check("memory", CRITICAL, "Memory is almost full", detail));
            else if (used >= 90) out.add(new Check("memory", WARNING, "Memory is running low", detail));
        }

        Double hottest = hottest(s);
        if (hottest != null && hottest >= 85) {
            out.add(new Check("temperature", hottest >= 95 ? CRITICAL : WARNING,
                    hottest >= 95 ? "Running very hot" : "Running hot",
                    String.format(Locale.US, "%.0f °C. It slows itself down to cool off; check that the vents aren't blocked.", hottest)));
        }

        for (PhysicalDisk p : list(s.physicalDisks())) {
            String name = p.name() == null ? "The SSD" : p.name();
            if (p.health() != null && !"Healthy".equalsIgnoreCase(p.health())) {
                out.add(new Check("ssd", CRITICAL, name + " reports a problem",
                        "Windows rates its health \"" + p.health() + "\". Back up anything that matters."));
            } else if (p.wearPct() != null && p.wearPct() >= 80) {
                out.add(new Check("ssd", WARNING, name + " is wearing out",
                        String.format(Locale.US, "%.0f%% of its rated writes used.", p.wearPct())));
            } else if (p.temperatureC() != null && p.temperatureC() >= 75) {
                out.add(new Check("ssd", WARNING, name + " is hot", String.format(Locale.US, "%.0f °C.", p.temperatureC())));
            }
        }

        Docker docker = s.docker();
        if (docker != null && Boolean.FALSE.equals(docker.ok())) {
            out.add(new Check("docker", CRITICAL, "Docker isn't responding",
                    (docker.error() == null ? "" : docker.error() + ". ")
                            + "Running apps may carry on, but nothing can be deployed, started or stopped. Restarting Docker Desktop usually clears it."));
        } else if (docker != null) {
            for (Container c : list(docker.containers())) {
                if (c.name() == null || !c.name().startsWith(OWN_CONTAINERS)) continue;
                if (!"running".equals(c.state())) {
                    out.add(new Check("containers", CRITICAL, c.name() + " isn't running", Objects.toString(c.status(), "")));
                } else if ("unhealthy".equals(c.health())) {
                    out.add(new Check("containers", WARNING, c.name() + " is unhealthy", Objects.toString(c.status(), "")));
                }
            }
        }

        Power power = s.power();
        if (power != null && power.sleepAfterMinutes() != null && power.sleepAfterMinutes() > 0) {
            out.add(new Check("power", WARNING, "Set to sleep after " + power.sleepAfterMinutes() + " minutes",
                    "Asleep, it stops recording, syncing and serving the app. Set Sleep to Never in Windows' power settings."));
        }
        if (power != null && Boolean.TRUE.equals(power.pendingReboot())) {
            out.add(new Check("updates", WARNING, "Windows wants to restart",
                    "Updates are waiting on a restart. Do it at a quiet time, or Windows will pick one."));
        }

        Instant weekAgo = now.minus(Duration.ofDays(7));
        list(s.events()).stream()
                .filter(e -> Integer.valueOf(41).equals(e.id()) && e.at() != null && e.at().isAfter(weekAgo))
                .findFirst()
                .ifPresent(e -> {
                    String previous = list(s.events()).stream().filter(x -> Integer.valueOf(6008).equals(x.id()) && x.message() != null)
                            .findFirst().map(x -> " " + x.message()).orElse("");
                    out.add(new Check("crash", WARNING, "Froze or lost power recently",
                            "It started again " + when(e.at()) + " without having shut down cleanly." + previous));
                });

        if (s.agent() != null && !list(s.agent().errors()).isEmpty()) {
            out.add(new Check("monitor", WARNING, "Some readings failed", String.join("; ", s.agent().errors())));
        }

        out.sort(Comparator.comparing(c -> CRITICAL.equals(c.level()) ? 0 : 1));
        return out;
    }

    // ── Alerts ──

    private void alert(List<Check> checks) {
        RULES.forEach((key, rule) -> {
            Optional<Check> hit = checks.stream()
                    .filter(c -> c.key().equals(key) && (CRITICAL.equals(c.level()) || rule.warningToo()))
                    .findFirst();
            if (hit.isEmpty()) {
                streaks.remove(key);
                return;
            }
            int run = streaks.merge(key, 1, Integer::sum);
            if (run >= rule.samples()) {
                Check c = hit.get();
                notifyAdmins(rule.title(), CRITICAL.equals(c.level()) ? Severity.CRITICAL : Severity.WARNING,
                        c.title() + ". " + c.detail(), REMIND_EVERY);
            }
        });
    }

    /** A later boot time than the previous sample's: tell the admins when, how long it was out, and why if Windows knows. */
    private void noticeRestart(HostMetricSample previous, HostSnapshot s) {
        Instant boot = s.host() == null ? null : s.host().bootTime();
        if (boot == null || previous.getBootTime() == null) return;
        // The same boot can be reported a few seconds apart.
        if (!boot.isAfter(previous.getBootTime().toInstant(ZoneOffset.UTC).plus(Duration.ofMinutes(1)))) return;
        Instant lastHeard = previous.getCollectedAt().toInstant(ZoneOffset.UTC);
        String down = span(Duration.between(lastHeard, boot));
        List<PowerEvent> since = list(s.events()).stream()
                .filter(e -> e.at() != null && !e.at().isBefore(lastHeard.minus(Duration.ofMinutes(2))))
                .toList();
        boolean unexpected = since.stream().anyMatch(e -> "unexpected".equals(e.kind()));
        Optional<PowerEvent> planned = since.stream().filter(e -> Integer.valueOf(1074).equals(e.id())).findFirst();
        String message;
        Severity severity;
        if (unexpected) {
            severity = Severity.WARNING;
            message = "It started again " + when(boot) + " without having shut down cleanly: it lost power or froze. "
                    + "It last reported " + when(lastHeard) + ", " + down + " earlier.";
        } else if (planned.isPresent()) {
            severity = Severity.INFO;
            message = "It started again " + when(boot) + " after a restart" + restartCause(planned.get().message())
                    + ". It was out for " + down + ".";
        } else {
            severity = Severity.INFO;
            message = "It started again " + when(boot) + ". It last reported " + when(lastHeard) + ", " + down + " earlier.";
        }
        // Restarts are separate events: only an hour's dedup, against a reread of the same one.
        notifyAdmins(TITLE_RESTARTED, severity, message, Duration.ofHours(1));
    }

    /** " by TrustedInstaller.exe (Operating System: Upgrade (Planned))" from event 1074's text. */
    static String restartCause(String message) {
        if (message == null) return "";
        Matcher by = RESTART_BY.matcher(message);
        Matcher why = RESTART_REASON.matcher(message);
        // "C:\WINDOWS\servicing\TrustedInstaller.exe": just the program.
        String who = by.find() ? " by " + by.group(1).substring(by.group(1).lastIndexOf('\\') + 1).trim() : "";
        String reason = why.find() ? " (" + why.group(1).trim() + ")" : "";
        return who + reason;
    }

    /** The monitor stopped: no sample for {@link #STOPPED}. Only once it has ever reported. */
    @Scheduled(initialDelay = 120_000, fixedDelay = 60_000)
    public void checkMonitor() {
        HostMetricSample last = newest();
        if (last == null) return;
        Instant at = last.getCollectedAt().toInstant(ZoneOffset.UTC);
        if (Duration.between(at, clock.instant()).compareTo(STOPPED) < 0) return;
        notifyAdmins(TITLE_STOPPED, Severity.WARNING,
                "No report from the NUC's health monitor since " + when(at) + ". On the NUC, check the HomeHostMetrics "
                        + "task: schtasks /query /tn HomeHostMetrics.", REMIND_EVERY);
    }

    private void notifyAdmins(String title, Severity severity, String message, Duration dedup) {
        if (notificationService == null || users == null) return;
        LocalDateTime since = LocalDateTime.now().minus(dedup);
        for (User admin : users.findByRoleAndStatus(User.Role.ADMIN, User.AccountStatus.ACTIVE)) {
            if (notifications != null && notifications.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(
                    admin.getId(), Category.SYSTEM, title, since)) {
                continue;
            }
            notificationService.create(admin.getId(), Category.SYSTEM, severity, title, message);
        }
    }

    // ── Reads ──

    public HostHealthResponse view() {
        Instant now = clock.instant();
        HostSnapshot s = latest;
        HostMetricSample stored = newest();
        Instant last = s != null ? s.collectedAt()
                : stored != null ? stored.getCollectedAt().toInstant(ZoneOffset.UTC) : null;
        String status = last == null ? "NOT_SET_UP"
                : Duration.between(last, now).compareTo(STALE) > 0 ? "OFFLINE" : "ONLINE";
        List<Check> checks = new ArrayList<>();
        if ("OFFLINE".equals(status)) {
            checks.add(new Check("monitor", CRITICAL, "The health monitor stopped reporting",
                    "Last report " + when(last) + ". On the NUC, check the HomeHostMetrics task: schtasks /query /tn HomeHostMetrics."));
        }
        checks.addAll(checks(s, now));
        return new HostHealthResponse(status, last, now, s, checks, appStats());
    }

    AppStats appStats() {
        Long dbBytes = null;
        List<TableSize> tables = List.of();
        if (jdbc != null) {
            try {
                dbBytes = jdbc.queryForObject("SELECT pg_database_size(current_database())", Long.class);
                tables = jdbc.query("SELECT relname, pg_total_relation_size(relid) AS bytes FROM pg_catalog.pg_statio_user_tables "
                                + "ORDER BY bytes DESC LIMIT 6",
                        (rs, i) -> new TableSize(rs.getString(1), rs.getLong(2)));
            } catch (Exception e) {
                log.debug("Database size unavailable: {}", e.getMessage()); // H2 in tests
            }
        }
        Runtime rt = Runtime.getRuntime();
        return new AppStats(dbBytes, tables, rt.totalMemory() - rt.freeMemory(), rt.maxMemory(),
                ManagementFactory.getRuntimeMXBean().getUptime() / 1000, ManagementFactory.getThreadMXBean().getThreadCount(),
                samples.count());
    }

    /** {@code range}: 24h, 7d or 30d. */
    public HostHistoryResponse history(String range) {
        Range r = RANGES.get(range);
        if (r == null) throw new IllegalArgumentException("range must be 24h, 7d or 30d");
        Instant now = clock.instant();
        long size = r.bucket().toSeconds();
        Instant from = Instant.ofEpochSecond(Math.floorDiv(now.minus(r.span()).getEpochSecond(), size) * size);
        List<HostMetricSample> rows = samples.findByCollectedAtGreaterThanEqualOrderByCollectedAtAsc(utc(from));

        int n = (int) ((now.getEpochSecond() - from.getEpochSecond()) / size) + 1;
        List<List<HostMetricSample>> buckets = new ArrayList<>(n);
        for (int i = 0; i < n; i++) buckets.add(new ArrayList<>());
        for (HostMetricSample row : rows) {
            int i = (int) ((epoch(row.getCollectedAt()) - from.getEpochSecond()) / size);
            if (i >= 0 && i < n) buckets.get(i).add(row);
        }
        List<HostHistoryResponse.Point> points = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            List<HostMetricSample> b = buckets.get(i);
            points.add(new HostHistoryResponse.Point(from.plusSeconds(i * size),
                    round(avg(b, HostMetricSample::getCpuPct)), round(max(b, HostMetricSample::getCpuPct)),
                    round(avg(b, HostMetricsService::memPct)),
                    round(avg(b, HostMetricSample::getCpuTempC)), round(avg(b, HostMetricSample::getDiskTempC)),
                    round2(mbps(avg(b, HostMetricSample::getNetRxBps))), round2(mbps(avg(b, HostMetricSample::getNetTxBps)))));
        }

        double rx = 0, tx = 0;
        List<HostHistoryResponse.Gap> gaps = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            HostMetricSample row = rows.get(i);
            // Each sample covers the minute before it (up to two, if one was skipped).
            long covered = 60;
            if (i > 0) {
                HostMetricSample prev = rows.get(i - 1);
                long between = epoch(row.getCollectedAt()) - epoch(prev.getCollectedAt());
                covered = Math.min(between, 120);
                if (between >= GAP.toSeconds()) {
                    boolean restarted = row.getBootTime() != null && prev.getBootTime() != null
                            && row.getBootTime().isAfter(prev.getBootTime().plusMinutes(1));
                    gaps.add(new HostHistoryResponse.Gap(prev.getCollectedAt().toInstant(ZoneOffset.UTC),
                            row.getCollectedAt().toInstant(ZoneOffset.UTC), between / 60, restarted));
                }
            }
            if (row.getNetRxBps() != null) rx += row.getNetRxBps() * covered;
            if (row.getNetTxBps() != null) tx += row.getNetTxBps() * covered;
        }

        HostHistoryResponse.Summary summary = new HostHistoryResponse.Summary(rows.size(),
                round(avg(rows, HostMetricSample::getCpuPct)), round(max(rows, HostMetricSample::getCpuPct)),
                round(avg(rows, HostMetricsService::memPct)), round(max(rows, HostMetricsService::memPct)),
                round(max(rows, HostMetricSample::getCpuTempC)), rows.isEmpty() ? null : rx, rows.isEmpty() ? null : tx);
        Instant first = rows.isEmpty() ? null : rows.get(0).getCollectedAt().toInstant(ZoneOffset.UTC);
        return new HostHistoryResponse(range, (int) r.bucket().toMinutes(), from, now, first, points, summary, gaps);
    }

    /** Retention: drop samples older than {@link #RETENTION_DAYS}. Nightly, 3:40 AM CT. */
    @Scheduled(cron = "0 40 3 * * *", zone = "America/Chicago")
    public void cleanup() {
        int removed = samples.deleteCollectedBefore(utc(clock.instant().minus(Duration.ofDays(RETENTION_DAYS))));
        if (removed > 0) log.info("host_metrics retention: removed {} samples older than {} days", removed, RETENTION_DAYS);
    }

    // ── Helpers ──

    private HostMetricSample newest() {
        if (!newestLoaded) {
            newest = samples.findTopByOrderByCollectedAtDesc().orElse(null);
            newestLoaded = true;
        }
        return newest;
    }

    /** Used share of memory in a stored sample, 0–100. */
    static Double memPct(HostMetricSample s) {
        return s.getMemTotalBytes() == null || s.getMemTotalBytes() <= 0 || s.getMemUsedBytes() == null ? null
                : 100.0 * s.getMemUsedBytes() / s.getMemTotalBytes();
    }

    static Disk systemDrive(HostSnapshot s) {
        List<Disk> disks = list(s.disks());
        return disks.stream().filter(d -> "C:".equalsIgnoreCase(d.name())).findFirst()
                .orElse(disks.isEmpty() ? null : disks.get(0));
    }

    static Double hottest(HostSnapshot s) {
        return list(s.temperatures()).stream().map(Temperature::celsius).filter(Objects::nonNull).max(Double::compare).orElse(null);
    }

    private static <T> List<T> list(List<T> l) {
        return l == null ? List.of() : l.stream().filter(Objects::nonNull).toList();
    }

    private static Double avg(List<HostMetricSample> rows, Function<HostMetricSample, Double> f) {
        OptionalDouble a = rows.stream().map(f).filter(Objects::nonNull).mapToDouble(Double::doubleValue).average();
        return a.isPresent() ? a.getAsDouble() : null;
    }

    private static Double max(List<HostMetricSample> rows, Function<HostMetricSample, Double> f) {
        OptionalDouble a = rows.stream().map(f).filter(Objects::nonNull).mapToDouble(Double::doubleValue).max();
        return a.isPresent() ? a.getAsDouble() : null;
    }

    private static Double mbps(Double bytesPerSecond) {
        return bytesPerSecond == null ? null : bytesPerSecond * 8 / 1_000_000;
    }

    private static Double round(Double v) {
        return v == null ? null : Math.round(v * 10) / 10.0;
    }

    private static Double round2(Double v) {
        return v == null ? null : Math.round(v * 100) / 100.0;
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static long epoch(LocalDateTime utc) {
        return utc.toEpochSecond(ZoneOffset.UTC);
    }

    /** "Nov 2, 9:06 PM", home time. */
    static String when(Instant i) {
        return i == null ? "?" : WHEN.format(i.atZone(CHICAGO));
    }

    /** Windows-style sizes: binary, labelled GB. "60.1 GB". */
    static String gb(long bytes) {
        return String.format(Locale.US, "%.1f GB", bytes / 1073741824.0);
    }

    /** "12 min", "43 h", "3 days". */
    static String span(Duration d) {
        long min = Math.max(0, d.toMinutes());
        if (min < 90) return min + " min";
        long h = Math.round(min / 60.0);
        if (h < 48) return h + " h";
        return Math.round(h / 24.0) + " days";
    }
}
