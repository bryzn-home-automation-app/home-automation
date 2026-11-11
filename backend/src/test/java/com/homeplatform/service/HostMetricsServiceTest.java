package com.homeplatform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.HostHealthResponse;
import com.homeplatform.dto.HostHealthResponse.Check;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.*;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** NUC Health: reading the monitor's file, the checks, the admin alerts and the history. */
class HostMetricsServiceTest {

    private static final Instant T0 = Instant.parse("2026-11-07T06:00:00Z");
    private static final Instant BOOT = Instant.parse("2026-11-04T22:11:01Z");
    private static final long ADMIN = 1L;

    /** What scripts/host-metrics.ps1 writes (trimmed), with made-up names. */
    private static final String SAMPLE = """
            {"collectedAt":"2026-11-07T05:59:30Z","intervalSeconds":58.2,
             "host":{"name":"NUC","model":"Intel(R) Client Systems NUC10i3FNH","os":"Microsoft Windows 11 Home",
                     "osBuild":"10.0.26200","cpuModel":"Intel(R) Core(TM) i3-10110U CPU @ 2.10GHz","cores":2,
                     "logicalProcessors":4,"bootTime":"2026-11-04T22:11:01Z"},
             "cpu":{"usagePct":26,"clockMhz":2093,"maxClockMhz":2592},
             "memory":{"totalBytes":16970715136,"availableBytes":4700983296,"commitBytes":13259141120,"commitLimitBytes":20863029248},
             "disks":{"name":"C:","label":"","totalBytes":254870024192,"freeBytes":64501051392,"readBps":377471.2,"writeBps":355819},
             "physicalDisks":[{"name":"SKHynix_HFM256GDHTNI-87A0B","mediaType":"SSD","sizeBytes":256060514304,
                               "health":"Healthy","temperatureC":41,"wearPct":0,"powerOnHours":null}],
             "temperatures":[{"name":"TZ.TZ00","celsius":57.1}],
             "network":{"adapter":"Wi-Fi","description":"Intel(R) Wi-Fi 6 AX201 160MHz","linkMbps":1201,"ip":"192.168.1.10",
                        "rxBps":35788.8,"txBps":3561.5,
                        "wifi":{"ssid":"home","signalPct":98,"rssi":-32,"band":"5 GHz","channel":"100","radio":"802.11ax","rxMbps":1201,"txMbps":1201},
                        "tailscaleUp":true},
             "power":{"plan":"Balanced","sleepAfterMinutes":0,"pendingReboot":false},
             "events":[{"at":"2026-11-04T22:11:17Z","id":6008,"kind":"unexpected","message":"The previous system shutdown at 9:06:20 PM on 11/2/2026 was unexpected."},
                       {"at":"2026-11-04T22:11:03Z","id":41,"kind":"unexpected","message":"The system has rebooted without cleanly shutting down first."}],
             "topCpu":[{"name":"vmmemWSL","count":1,"cpuPct":10.4,"memBytes":7057063936}],
             "topMemory":[{"name":"vmmemWSL","count":1,"cpuPct":10.4,"memBytes":7057063936}],
             "docker":{"ok":true,"error":null,"version":"29.7.2","cpus":4,"memTotalBytes":7271218790,
                       "containers":[{"name":"homeplatform-backend","project":"home-automation","service":"backend","image":"home-automation-backend",
                                      "state":"running","status":"Up 3 hours (healthy)","health":"healthy","cpuPct":1.2,
                                      "memBytes":600000000,"memLimitBytes":7271218790},
                                     {"name":"other-app","project":"other","image":"x","state":"exited","status":"Exited (0) 2 days ago",
                                      "health":null,"cpuPct":null,"memBytes":null,"memLimitBytes":null}]},
             "agent":{"version":1,"durationMs":5400,"sectionMs":{"docker":2900},"errors":[]},
             "somethingNew":"ignored"}
            """;

    @TempDir Path dir;
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final List<HostMetricSample> stored = new ArrayList<>();
    private HostMetricSampleRepository repo;
    private NotificationService notificationService;
    private NotificationRepository notifications;
    private final MutableClock clock = new MutableClock(T0);
    private HostMetricsService service;

    static final class MutableClock extends Clock {
        Instant now;
        MutableClock(Instant now) { this.now = now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @BeforeEach
    void setUp() {
        repo = mock(HostMetricSampleRepository.class);
        when(repo.save(any(HostMetricSample.class))).thenAnswer(inv -> {
            HostMetricSample s = inv.getArgument(0);
            s.setId((long) stored.size() + 1);
            stored.add(s);
            return s;
        });
        when(repo.findTopByOrderByCollectedAtDesc()).thenAnswer(inv -> stored.stream()
                .max(Comparator.comparing(HostMetricSample::getCollectedAt)));
        when(repo.findByCollectedAtGreaterThanEqualOrderByCollectedAtAsc(any())).thenAnswer(inv -> {
            LocalDateTime from = inv.getArgument(0);
            return stored.stream().filter(s -> !s.getCollectedAt().isBefore(from))
                    .sorted(Comparator.comparing(HostMetricSample::getCollectedAt)).toList();
        });
        notificationService = mock(NotificationService.class);
        notifications = mock(NotificationRepository.class);
        UserRepository users = mock(UserRepository.class);
        when(users.findByRoleAndStatus(User.Role.ADMIN, User.AccountStatus.ACTIVE))
                .thenReturn(List.of(User.builder().id(ADMIN).username("admin").role(User.Role.ADMIN).build()));
        service = new HostMetricsService(repo, mapper, dir.resolve("metrics.json"), clock,
                notificationService, notifications, users, null);
    }

    private HostSnapshot sample() throws Exception {
        return mapper.readValue(SAMPLE, HostSnapshot.class);
    }

    /** The sample, taken at {@code at} on a NUC booted at {@code boot}. */
    private HostSnapshot at(Instant at, Instant boot) throws Exception {
        HostSnapshot s = sample();
        Host h = s.host();
        return new HostSnapshot(at, s.intervalSeconds(), new Host(h.name(), h.model(), h.os(), h.osBuild(), h.cpuModel(),
                h.cores(), h.logicalProcessors(), boot), s.cpu(), s.memory(), s.disks(), s.physicalDisks(), s.temperatures(),
                s.network(), s.power(), s.events(), s.topCpu(), s.topMemory(), s.docker(), s.agent());
    }

    /** Ingest {@code s} as it arrives: the clock is at its time. */
    private void take(HostSnapshot s) {
        clock.now = s.collectedAt();
        service.ingest(s);
    }

    private static HostSnapshot withDocker(HostSnapshot s, Docker d) {
        return new HostSnapshot(s.collectedAt(), s.intervalSeconds(), s.host(), s.cpu(), s.memory(), s.disks(), s.physicalDisks(),
                s.temperatures(), s.network(), s.power(), s.events(), s.topCpu(), s.topMemory(), d, s.agent());
    }

    private static HostSnapshot withEvents(HostSnapshot s, List<PowerEvent> events) {
        return new HostSnapshot(s.collectedAt(), s.intervalSeconds(), s.host(), s.cpu(), s.memory(), s.disks(), s.physicalDisks(),
                s.temperatures(), s.network(), s.power(), events, s.topCpu(), s.topMemory(), s.docker(), s.agent());
    }

    @Test
    @DisplayName("reads the monitor's file once per sample and stores its headline numbers")
    void poll() throws Exception {
        Files.writeString(dir.resolve("metrics.json"), SAMPLE);
        service.poll();
        service.poll(); // same sample again: nothing new

        assertThat(stored).hasSize(1);
        HostMetricSample s = stored.get(0);
        assertThat(s.getCollectedAt()).isEqualTo(LocalDateTime.of(2026, 11, 7, 5, 59, 30));
        assertThat(s.getCpuPct()).isEqualTo(26.0);
        assertThat(s.getMemUsedBytes()).isEqualTo(16970715136L - 4700983296L);
        // "disks" came as a lone object, as PowerShell writes a one-item list.
        assertThat(s.getDiskFreeBytes()).isEqualTo(64501051392L);
        assertThat(s.getNetRxBps()).isEqualTo(35788.8);
        assertThat(s.getCpuTempC()).isEqualTo(57.1);
        assertThat(s.getDiskTempC()).isEqualTo(41.0);
        assertThat(s.getContainersMemBytes()).isEqualTo(600000000L);
        assertThat(s.getBootTime()).isEqualTo(LocalDateTime.of(2026, 11, 4, 22, 11, 1));

        HostHealthResponse view = service.view();
        assertThat(view.status()).isEqualTo("ONLINE");
        assertThat(view.latest().docker().containers()).hasSize(2);
        // The Compose labels the page groups by; a monitor older than agent version 2 sends no service.
        assertThat(view.latest().docker().containers()).extracting(Container::project).containsExactly("home-automation", "other");
        assertThat(view.latest().docker().containers()).extracting(Container::service).containsExactly("backend", null);
        // Only the crash on Nov 4 is worth flagging; the other app's stopped container isn't ours.
        assertThat(view.checks()).extracting(Check::key).containsExactly("crash");
        assertThat(view.checks().get(0).detail()).contains("Nov 4, 4:11 PM").contains("9:06:20 PM on 11/2/2026");
    }

    @Test
    @DisplayName("not set up, online, and offline once samples stop")
    void status() throws Exception {
        assertThat(service.view().status()).isEqualTo("NOT_SET_UP");
        service.ingest(at(T0.minusSeconds(30), BOOT));
        assertThat(service.view().status()).isEqualTo("ONLINE");
        clock.now = T0.plus(Duration.ofMinutes(6));
        HostHealthResponse view = service.view();
        assertThat(view.status()).isEqualTo("OFFLINE");
        assertThat(view.checks().get(0).key()).isEqualTo("monitor");
        assertThat(view.checks().get(0).level()).isEqualTo("critical");
    }

    @Test
    @DisplayName("flags a full drive, low memory, heat, a failing SSD, sleep and pending updates")
    void checks() throws Exception {
        String bad = SAMPLE
                .replace("\"freeBytes\":64501051392", "\"freeBytes\":10000000000")         // 96% used
                .replace("\"availableBytes\":4700983296", "\"availableBytes\":1500000000") // 91% used
                .replace("\"celsius\":57.1", "\"celsius\":96")
                .replace("\"health\":\"Healthy\"", "\"health\":\"Warning\"")
                .replace("\"sleepAfterMinutes\":0", "\"sleepAfterMinutes\":30")
                .replace("\"pendingReboot\":false", "\"pendingReboot\":true");
        List<Check> checks = service.checks(mapper.readValue(bad, HostSnapshot.class), T0);
        assertThat(checks).extracting(Check::key)
                .contains("disk", "memory", "temperature", "ssd", "power", "updates", "crash");
        assertThat(checks.get(0).level()).isEqualTo("critical"); // worst first
        assertThat(checks).filteredOn(c -> c.key().equals("disk")).first()
                .satisfies(c -> {
                    assertThat(c.level()).isEqualTo("critical");
                    assertThat(c.detail()).isEqualTo("9.3 GB free of 237.4 GB.");
                });
        assertThat(checks).filteredOn(c -> c.key().equals("memory")).first()
                .satisfies(c -> assertThat(c.level()).isEqualTo("warning"));
        assertThat(checks).filteredOn(c -> c.key().equals("power")).first()
                .satisfies(c -> assertThat(c.title()).isEqualTo("Set to sleep after 30 minutes"));
    }

    @Test
    @DisplayName("a crash more than a week old is history, not a warning")
    void oldCrash() throws Exception {
        clock.now = BOOT.plus(Duration.ofDays(8));
        assertThat(service.checks(at(clock.now, BOOT), clock.now)).isEmpty();
    }

    @Test
    @DisplayName("Docker not answering, or one of our containers down, is critical")
    void docker() throws Exception {
        HostSnapshot s = sample();
        List<Check> down = service.checks(withDocker(s, new Docker(false, "no answer from Docker within 15 s", null, null, null, List.of())), T0);
        assertThat(down).filteredOn(c -> c.key().equals("docker")).singleElement()
                .satisfies(c -> {
                    assertThat(c.level()).isEqualTo("critical");
                    assertThat(c.detail()).startsWith("no answer from Docker within 15 s. ");
                });

        Container stopped = new Container("homeplatform-nginx", "home-automation", "nginx", "nginx", "exited", "Exited (1) 5 minutes ago",
                null, null, null, null);
        List<Check> checks = service.checks(withDocker(s, new Docker(true, null, "29.7.2", 4, 1L, List.of(stopped))), T0);
        assertThat(checks).filteredOn(c -> c.key().equals("containers")).singleElement()
                .satisfies(c -> {
                    assertThat(c.title()).isEqualTo("homeplatform-nginx isn't running");
                    assertThat(c.detail()).isEqualTo("Exited (1) 5 minutes ago");
                });
    }

    @Test
    @DisplayName("admins hear about Docker after three samples in a row, and not again within a day")
    void dockerAlert() throws Exception {
        Docker dead = new Docker(false, "request returned 500 Internal Server Error", null, null, null, List.of());
        for (int i = 0; i < 2; i++) take(withDocker(at(T0.plusSeconds(60L * i), BOOT), dead));
        verify(notificationService, never()).create(anyLong(), any(), any(), eq("Docker on the NUC isn't responding"), any());

        take(withDocker(at(T0.plusSeconds(120), BOOT), dead));
        verify(notificationService).create(eq(ADMIN), eq(Category.SYSTEM), eq(Severity.CRITICAL),
                eq("Docker on the NUC isn't responding"), contains("500 Internal Server Error"));

        when(notifications.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(eq(ADMIN), eq(Category.SYSTEM),
                eq("Docker on the NUC isn't responding"), any())).thenReturn(true);
        take(withDocker(at(T0.plusSeconds(180), BOOT), dead));
        verify(notificationService, times(1)).create(anyLong(), any(), any(), eq("Docker on the NUC isn't responding"), any());

        // Recovered, then down again: the count starts over.
        take(at(T0.plusSeconds(240), BOOT));
        take(withDocker(at(T0.plusSeconds(300), BOOT), dead));
        verify(notificationService, times(1)).create(anyLong(), any(), any(), eq("Docker on the NUC isn't responding"), any());
    }

    @Test
    @DisplayName("a restart after a crash is a warning saying how long it was out")
    void crashRestart() throws Exception {
        Instant lastHeard = Instant.parse("2026-11-03T03:06:00Z"); // Nov 2, 9:06 PM CT
        Instant oldBoot = Instant.parse("2026-10-30T12:00:00Z");
        service.ingest(at(lastHeard, oldBoot));
        clock.now = Instant.parse("2026-11-04T22:13:00Z");
        service.ingest(at(Instant.parse("2026-11-04T22:12:30Z"), BOOT));

        ArgumentCaptor<String> message = ArgumentCaptor.forClass(String.class);
        verify(notificationService).create(eq(ADMIN), eq(Category.SYSTEM), eq(Severity.WARNING), eq("NUC restarted"), message.capture());
        assertThat(message.getValue()).isEqualTo("It started again Nov 4, 4:11 PM without having shut down cleanly: "
                + "it lost power or froze. It last reported Nov 2, 9:06 PM, 43 h earlier.");
    }

    @Test
    @DisplayName("a planned restart says who asked for it")
    void plannedRestart() throws Exception {
        Instant oldBoot = Instant.parse("2026-11-01T12:00:00Z");
        Instant lastHeard = Instant.parse("2026-11-07T09:00:00Z");
        Instant boot = Instant.parse("2026-11-07T09:03:00Z");
        take(at(lastHeard, oldBoot));
        PowerEvent planned = new PowerEvent(Instant.parse("2026-11-07T09:00:30Z"), 1074, "restart",
                "The process C:\\WINDOWS\\servicing\\TrustedInstaller.exe (NUC) has initiated the restart of computer NUC on behalf "
                        + "of user NT AUTHORITY\\SYSTEM for the following reason: Operating System: Upgrade (Planned) "
                        + "Reason Code: 0x80020003 Shutdown Type: restart Comment:");
        take(withEvents(at(boot.plusSeconds(60), boot), List.of(planned)));

        verify(notificationService).create(eq(ADMIN), eq(Category.SYSTEM), eq(Severity.INFO), eq("NUC restarted"),
                eq("It started again Nov 7, 3:03 AM after a restart by TrustedInstaller.exe "
                        + "(Operating System: Upgrade (Planned)). It was out for 3 min."));
    }

    @Test
    @DisplayName("the same boot is not a restart")
    void sameBoot() throws Exception {
        service.ingest(at(T0, BOOT));
        service.ingest(at(T0.plusSeconds(60), BOOT.plusSeconds(2)));
        verify(notificationService, never()).create(anyLong(), any(), any(), eq("NUC restarted"), any());
    }

    @Test
    @DisplayName("admins hear when the monitor goes quiet for ten minutes")
    void monitorStopped() throws Exception {
        service.ingest(at(T0, BOOT));
        clock.now = T0.plus(Duration.ofMinutes(9));
        service.checkMonitor();
        verify(notificationService, never()).create(anyLong(), any(), any(), eq("NUC health monitor stopped"), any());
        clock.now = T0.plus(Duration.ofMinutes(11));
        service.checkMonitor();
        verify(notificationService).create(eq(ADMIN), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("NUC health monitor stopped"), contains("since Nov 7, 12:00 AM"));
    }

    @Test
    @DisplayName("history averages into buckets, leaves empty ones blank, and finds gaps and restarts")
    void history() throws Exception {
        clock.now = T0;
        Instant start = T0.minus(Duration.ofHours(2));
        // 30 minutes of samples, 20 quiet minutes (it restarted), then the rest of the time.
        for (int m = 0; m < 30; m++) service.ingest(at(start.plus(Duration.ofMinutes(m)), BOOT));
        Instant newBoot = start.plus(Duration.ofMinutes(45));
        for (int m = 50; m < 120; m++) service.ingest(at(start.plus(Duration.ofMinutes(m)), newBoot));

        HostHistoryResponse h = service.history("24h");
        assertThat(h.bucketMinutes()).isEqualTo(5);
        assertThat(h.points()).hasSize(24 * 12 + 1);
        assertThat(h.summary().samples()).isEqualTo(100);
        assertThat(h.summary().cpuAvg()).isEqualTo(26.0);
        assertThat(h.firstSampleAt()).isEqualTo(start);

        // A bucket inside the gap has no numbers; one with samples does.
        Instant inGap = start.plus(Duration.ofMinutes(35));
        assertThat(h.points()).filteredOn(p -> p.t().equals(inGap)).singleElement()
                .satisfies(p -> assertThat(p.cpuAvg()).isNull());
        assertThat(h.points()).filteredOn(p -> p.t().equals(start)).singleElement()
                .satisfies(p -> {
                    assertThat(p.cpuAvg()).isEqualTo(26.0);
                    assertThat(p.memPct()).isEqualTo(72.3);
                    assertThat(p.rxMbps()).isEqualTo(0.29);
                });

        assertThat(h.gaps()).singleElement().satisfies(g -> {
            assertThat(g.from()).isEqualTo(start.plus(Duration.ofMinutes(29)));
            assertThat(g.to()).isEqualTo(start.plus(Duration.ofMinutes(50)));
            assertThat(g.minutes()).isEqualTo(21);
            assertThat(g.restarted()).isTrue();
        });
        // 101 minutes of traffic: each sample covers the minute before it, the one after the gap two.
        assertThat(h.summary().rxBytes()).isCloseTo(35788.8 * 60 * 101, org.assertj.core.data.Offset.offset(1.0));

        assertThat(service.history("7d").points()).hasSize(7 * 48 + 1);
        assertThatThrownBy(() -> service.history("1y")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("restart detail parsing copes with missing text")
    void restartCause() {
        assertThat(HostMetricsService.restartCause(null)).isEmpty();
        assertThat(HostMetricsService.restartCause("Something else entirely")).isEmpty();
    }
}
