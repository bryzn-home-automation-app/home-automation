package com.homeplatform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.model.NetworkDevice;
import com.homeplatform.model.User;
import com.homeplatform.repository.NetworkDeviceRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.PresenceService.Scan;
import com.homeplatform.service.PresenceService.Seen;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.*;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.*;

/** Who's home from Wi-Fi scans: sightings, the away timeout, people and the scanner's health. */
class PresenceServiceTest {

    private static final Instant T0 = Instant.parse("2026-10-26T17:00:00Z");
    private static final String PHONE = "5e:cb:e7:41:80:1a", WATCH = "22:6f:c5:f4:2c:a6", TV = "90:bf:d9:b1:d4:44";
    private static final long BRYAN = 1L, KIM = 2L, GUEST = 5L;

    @TempDir Path dir;
    private final Map<String, NetworkDevice> table = new LinkedHashMap<>();
    private NetworkDeviceRepository repo;
    private final MutableClock clock = new MutableClock(T0);
    private PresenceService service;

    /** A clock the test can move forward. */
    static final class MutableClock extends Clock {
        Instant now;
        MutableClock(Instant now) { this.now = now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repo = mock(NetworkDeviceRepository.class);
        when(repo.findByMacIn(anyCollection())).thenAnswer(inv -> ((Collection<String>) inv.getArgument(0)).stream()
                .map(table::get).filter(Objects::nonNull).toList());
        when(repo.saveAll(any())).thenAnswer(inv -> {
            for (NetworkDevice d : (Iterable<NetworkDevice>) inv.getArgument(0)) save(d);
            return inv.getArgument(0);
        });
        when(repo.save(any(NetworkDevice.class))).thenAnswer(inv -> save(inv.getArgument(0)));
        when(repo.findAll()).thenAnswer(inv -> new ArrayList<>(table.values()));
        when(repo.findById(any())).thenAnswer(inv -> table.values().stream()
                .filter(d -> d.getId().equals(inv.getArgument(0))).findFirst());
        UserRepository users = mock(UserRepository.class);
        List<User> all = List.of(
                User.builder().id(BRYAN).username("bryzncode").displayName("Bryan").role(User.Role.ADMIN).status(User.AccountStatus.ACTIVE).build(),
                User.builder().id(KIM).username("Kimstabun").displayName(null).role(User.Role.USER).status(User.AccountStatus.ACTIVE).build(),
                User.builder().id(GUEST).username("visitor").displayName("Visitor").role(User.Role.GUEST).status(User.AccountStatus.ACTIVE).build());
        when(users.findAll()).thenReturn(all);
        when(users.findByStatus(User.AccountStatus.ACTIVE)).thenReturn(all);
        service = new PresenceService(repo, users, new ObjectMapper().findAndRegisterModules(), dir.resolve("scan.json"),
                Duration.ofMinutes(15), clock);
    }

    private NetworkDevice save(NetworkDevice d) {
        if (d.getId() == null) d.setId((long) table.size() + 1);
        table.put(d.getMac(), d);
        return d;
    }

    /** Scan at {@code minutes} after T0 seeing {@code macs}; the clock moves there too. */
    private void scanAt(int minutes, String... macs) {
        clock.now = T0.plus(Duration.ofMinutes(minutes));
        service.ingest(new Scan(clock.now, "192.168.4.0/24",
                Arrays.stream(macs).map(m -> new Seen(m, "192.168.4." + (10 + Arrays.asList(macs).indexOf(m)), false)).toList()));
    }

    private static LocalDateTime at(int minutes) {
        return LocalDateTime.ofInstant(T0.plus(Duration.ofMinutes(minutes)), ZoneOffset.UTC);
    }

    private PresenceResponse.Device device(PresenceResponse view, String mac) {
        return view.devices().stream().filter(d -> d.mac().equals(mac)).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("a new device is recorded; missed scans shorter than the timeout don't restart its stretch")
    void stretches() {
        scanAt(0, PHONE);
        scanAt(10, PHONE);           // missed 9 scans (asleep), still the same stretch
        assertThat(table.get(PHONE).getFirstSeen()).isEqualTo(at(0));
        assertThat(table.get(PHONE).getPresentSince()).isEqualTo(at(0));
        assertThat(table.get(PHONE).getLastSeen()).isEqualTo(at(10));

        scanAt(40, PHONE);           // gone 30 minutes: a new arrival
        assertThat(table.get(PHONE).getPresentSince()).isEqualTo(at(40));
        assertThat(table.get(PHONE).getFirstSeen()).isEqualTo(at(0));
        assertThat(table.get(PHONE).getIp()).isEqualTo("192.168.4.10");
    }

    @Test
    @DisplayName("a member is home while one of their phones or watches was seen in the last 15 minutes")
    void people() {
        scanAt(0, PHONE, WATCH, TV);
        service.label(table.get(PHONE).getId(), " Bryan's iPhone ", "mobile", BRYAN);
        service.label(table.get(WATCH).getId(), "Bryan's Watch", "WATCH", BRYAN);
        service.label(table.get(TV).getId(), "Bryan's desktop", "COMPUTER", BRYAN);
        scanAt(10, WATCH, TV);
        scanAt(20, TV);

        PresenceResponse view = service.view();
        assertThat(view.scanner().online()).isTrue();
        assertThat(view.people()).hasSize(1);
        PresenceResponse.Person bryan = view.people().get(0);
        assertThat(bryan.name()).isEqualTo("Bryan");
        assertThat(bryan.home()).isTrue();     // the watch, 10 minutes ago
        assertThat(bryan.devices()).isEqualTo(3);
        assertThat(bryan.since()).isEqualTo(T0);
        assertThat(device(view, PHONE).home()).isFalse();
        assertThat(device(view, PHONE).name()).isEqualTo("Bryan's iPhone");
        assertThat(device(view, PHONE).type()).isEqualTo("MOBILE");
        assertThat(device(view, PHONE).owner()).isEqualTo("Bryan");
        assertThat(device(view, PHONE).privateAddress()).isTrue();
        assertThat(device(view, TV).privateAddress()).isFalse();
        assertThat(view.devices().get(0).name()).isNotNull(); // labeled devices first

        scanAt(30, TV);              // only the always-on computer is still here
        bryan = service.view().people().get(0);
        assertThat(bryan.home()).isFalse();
        assertThat(bryan.lastSeen()).isEqualTo(T0.plus(Duration.ofMinutes(10)));
    }

    @Test
    @DisplayName("the owner list is active members, not guests; a member with no phone or watch is unknown")
    void members() {
        scanAt(0, TV);
        service.label(table.get(TV).getId(), "Kim's laptop", "COMPUTER", KIM);

        PresenceResponse view = service.view();
        assertThat(view.members()).extracting(PresenceResponse.Member::name).containsExactly("Bryan", "Kimstabun");
        assertThat(view.people().get(0).name()).isEqualTo("Kimstabun");
        assertThat(view.people().get(0).home()).isNull();

        assertThatThrownBy(() -> service.label(table.get(TV).getId(), "x", "TV", GUEST))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.label(table.get(TV).getId(), "x", "toaster", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("with no scan for 5 minutes, nobody's presence is claimed either way")
    void scannerOffline() {
        scanAt(0, PHONE);
        service.label(table.get(PHONE).getId(), null, "MOBILE", BRYAN);
        clock.now = T0.plus(Duration.ofMinutes(6));

        PresenceResponse view = service.view();
        assertThat(view.scanner().online()).isFalse();
        assertThat(view.people().get(0).home()).isNull();
        assertThat(device(view, PHONE).home()).isNull();
    }

    @Test
    @DisplayName("bad MACs are skipped and a scan from the future is ignored")
    void rejects() {
        scanAt(0, "not-a-mac", "FF:FF:FF:FF:FF", PHONE.toUpperCase());
        assertThat(table).containsOnlyKeys(PHONE);

        service.ingest(new Scan(clock.now.plus(Duration.ofHours(1)), null, List.of(new Seen(TV, "192.168.4.9", true))));
        assertThat(table).doesNotContainKey(TV);
    }

    @Test
    @DisplayName("the scheduled poll reads the scanner's file once per scan")
    void pollsFile() throws Exception {
        service.poll(); // no file yet: nothing happens
        verify(repo, never()).saveAll(any());

        Files.writeString(dir.resolve("scan.json"), """
                {"scannedAt":"2026-10-26T17:00:00Z","subnet":"192.168.4.0/24",
                 "devices":[{"mac":"5e:cb:e7:41:80:1a","ip":"192.168.4.34","pinged":false}]}""");
        service.poll();
        service.poll(); // same scan again
        verify(repo, times(1)).saveAll(any());
        assertThat(table.get(PHONE).getIp()).isEqualTo("192.168.4.34");
        assertThat(service.view().scanner().devicesInLastScan()).isEqualTo(1);
    }

    @Test
    @DisplayName("labels are trimmed, blank clears them, and over-long ones are refused")
    void labels() {
        scanAt(0, TV);
        Long id = table.get(TV).getId();
        service.label(id, "  Living room TV ", "tv", null);
        assertThat(table.get(TV).getLabel()).isEqualTo("Living room TV");
        assertThat(table.get(TV).getDeviceType()).isEqualTo(NetworkDevice.DeviceType.TV);
        assertThat(table.get(TV).getOwnerUserId()).isNull();
        service.label(id, "  ", "", null);
        assertThat(table.get(TV).getLabel()).isNull();
        assertThat(table.get(TV).getDeviceType()).isNull();
        assertThatThrownBy(() -> service.label(id, "x".repeat(61), null, null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.label(99L, "x", null, null)).isInstanceOf(NoSuchElementException.class);
    }
}
