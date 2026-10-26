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
        when(users.findById(any())).thenAnswer(inv -> all.stream().filter(u -> u.getId().equals(inv.getArgument(0))).findFirst());
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
        service.ingest(new Scan(clock.now, "192.168.4.0/24", "192.168.4.228",
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

        service.ingest(new Scan(clock.now.plus(Duration.ofHours(1)), null, null, List.of(new Seen(TV, "192.168.4.9", true))));
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

    private static final String IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";

    /** What scripts/presence-identify.ps1 writes when the device opens the link. */
    private void deviceOpens(String token, String mac, String ip) throws Exception {
        Files.createDirectories(dir.resolve("identify"));
        Files.writeString(dir.resolve("identify").resolve(token + ".json"),
                "{\"ip\":\"" + ip + "\",\"mac\":\"" + mac + "\",\"at\":\"" + clock.now + "\"}");
    }

    @Test
    @DisplayName("linking: the device that opens the link becomes the member's, typed and named from its browser")
    void linksThisDevice() throws Exception {
        scanAt(0, PHONE);
        PresenceService.LinkStart start = service.startLink(BRYAN);
        assertThat(start.url()).isEqualTo("http://192.168.4.228:8099/identify?t=" + start.token());

        assertThat(service.checkLink(BRYAN, start.token(), IPHONE_UA).status()).isEqualTo("PENDING");

        clock.now = clock.now.plusSeconds(20);
        deviceOpens(start.token(), PHONE.toUpperCase(), "192.168.4.34");
        PresenceService.LinkStatus done = service.checkLink(BRYAN, start.token(), IPHONE_UA);
        assertThat(done.status()).isEqualTo("LINKED");
        assertThat(done.name()).isEqualTo("Bryan's iPhone");
        assertThat(done.type()).isEqualTo("MOBILE");
        NetworkDevice d = table.get(PHONE);
        assertThat(d.getOwnerUserId()).isEqualTo(BRYAN);
        assertThat(d.getIp()).isEqualTo("192.168.4.34");
        assertThat(d.getLastSeen()).isEqualTo(LocalDateTime.ofInstant(clock.now, ZoneOffset.UTC));

        // Used up.
        assertThatThrownBy(() -> service.checkLink(BRYAN, start.token(), IPHONE_UA)).isInstanceOf(NoSuchElementException.class);
    }

    @Test
    @DisplayName("linking keeps a name and type an admin already set, and adds a device the scan hasn't seen")
    void linkKeepsLabels() throws Exception {
        scanAt(0, TV);
        service.label(table.get(TV).getId(), "Office PC", "COMPUTER", null);
        PresenceService.LinkStart start = service.startLink(KIM);
        deviceOpens(start.token(), TV, "192.168.4.73");
        service.checkLink(KIM, start.token(), "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        assertThat(table.get(TV).getLabel()).isEqualTo("Office PC");
        assertThat(table.get(TV).getOwnerUserId()).isEqualTo(KIM);

        PresenceService.LinkStart second = service.startLink(KIM);
        deviceOpens(second.token(), WATCH, "192.168.4.27");
        assertThat(service.checkLink(KIM, second.token(), "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile").name())
                .isEqualTo("Kimstabun's phone");
        assertThat(table.get(WATCH).getFirstSeen()).isNotNull();
    }

    @Test
    @DisplayName("only the member who started a link can finish it, and it expires")
    void linkOwnership() throws Exception {
        scanAt(0, PHONE);
        PresenceService.LinkStart start = service.startLink(BRYAN);
        deviceOpens(start.token(), PHONE, "192.168.4.34");
        assertThatThrownBy(() -> service.checkLink(KIM, start.token(), IPHONE_UA)).isInstanceOf(NoSuchElementException.class);
        assertThatThrownBy(() -> service.checkLink(BRYAN, "../../etc/passwd", IPHONE_UA)).isInstanceOf(NoSuchElementException.class);

        clock.now = clock.now.plus(Duration.ofMinutes(4));
        assertThat(service.checkLink(BRYAN, start.token(), IPHONE_UA).status()).isEqualTo("EXPIRED");
        assertThat(table.get(PHONE).getOwnerUserId()).isNull();
    }

    @Test
    @DisplayName("a link can't start while the scanner isn't reporting")
    void linkNeedsScanner() {
        assertThatThrownBy(() -> service.startLink(BRYAN)).isInstanceOf(IllegalStateException.class);
        scanAt(0, PHONE);
        clock.now = clock.now.plus(Duration.ofMinutes(10));
        assertThatThrownBy(() -> service.startLink(BRYAN)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("device type from the browser")
    void userAgents() {
        assertThat(PresenceService.guessFromUserAgent(IPHONE_UA).type()).isEqualTo(NetworkDevice.DeviceType.MOBILE);
        assertThat(PresenceService.guessFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710)").type())
                .isEqualTo(NetworkDevice.DeviceType.TABLET);
        assertThat(PresenceService.guessFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").type())
                .isEqualTo(NetworkDevice.DeviceType.COMPUTER);
        assertThat(PresenceService.guessFromUserAgent(null).type()).isEqualTo(NetworkDevice.DeviceType.OTHER);
    }

    @Test
    @DisplayName("everyone away: every member with a phone or watch is away, and at least one is tracked")
    void everyoneAway() {
        scanAt(0, PHONE, WATCH, TV);
        assertThat(service.everyoneAway()).isFalse();              // nobody tracked yet
        service.label(table.get(PHONE).getId(), null, "MOBILE", BRYAN);
        service.label(table.get(WATCH).getId(), null, "WATCH", KIM);
        service.label(table.get(TV).getId(), null, "COMPUTER", KIM);
        assertThat(service.everyoneAway()).isFalse();              // both home

        scanAt(10, WATCH, TV);
        scanAt(20, TV);                                            // Bryan's phone gone 20 min, Kim's watch 10
        assertThat(service.everyoneAway()).isFalse();
        scanAt(30, TV);                                            // both gone 15+; the computer doesn't count
        assertThat(service.everyoneAway()).isTrue();

        clock.now = clock.now.plus(Duration.ofMinutes(6));          // scanner stops: not sure, so not away
        assertThat(service.everyoneAway()).isFalse();
    }
}
