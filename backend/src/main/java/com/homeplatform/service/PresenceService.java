package com.homeplatform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.model.NetworkDevice;
import com.homeplatform.repository.NetworkDeviceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Who's home, from the devices on the home Wi-Fi. scripts/presence-scan.ps1 runs on the
 * NUC every minute and writes the devices that answered to presence/scan.json, mounted
 * here at /presence. Each new scan updates {@code network_devices}.
 *
 * <p>A sleeping phone misses some scans, so a device counts as away only after
 * {@code awayAfterMinutes} without being seen.
 */
@Service
public class PresenceService {

    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    /** With no scan for this long, the scanner is offline and presence is unknown. */
    static final Duration SCANNER_STALE = Duration.ofMinutes(5);
    /** Unlabeled devices (visitors) are forgotten after this long away. */
    static final Duration FORGET_UNLABELED = Duration.ofDays(30);
    static final int MAX_DEVICES = 512;
    private static final Pattern MAC = Pattern.compile("^[0-9a-f]{2}(:[0-9a-f]{2}){5}$");
    private static final Pattern IPV4 = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}$");

    public record Scan(Instant scannedAt, String subnet, List<Seen> devices) {}

    public record Seen(String mac, String ip, Boolean pinged) {}

    private final NetworkDeviceRepository devices;
    private final ObjectMapper mapper;
    private final Path scanFile;
    private final Duration awayAfter;
    private final Clock clock;
    private volatile Instant lastScanAt;
    private volatile int lastScanCount;

    @Autowired
    public PresenceService(NetworkDeviceRepository devices, ObjectMapper mapper,
                           @Value("${app.presence.scan-file:/presence/scan.json}") String scanFile,
                           @Value("${app.presence.away-after-minutes:15}") int awayAfterMinutes) {
        this(devices, mapper, Path.of(scanFile), Duration.ofMinutes(awayAfterMinutes), Clock.systemUTC());
    }

    PresenceService(NetworkDeviceRepository devices, ObjectMapper mapper, Path scanFile, Duration awayAfter, Clock clock) {
        this.devices = devices;
        this.mapper = mapper;
        this.scanFile = scanFile;
        this.awayAfter = awayAfter;
        this.clock = clock;
    }

    /** Pick up the scanner's latest file. No file means presence isn't set up on this host. */
    @Scheduled(initialDelay = 20_000, fixedDelay = 30_000)
    public void poll() {
        try {
            Scan scan = mapper.readValue(Files.readAllBytes(scanFile), Scan.class);
            if (scan.scannedAt() != null && (lastScanAt == null || scan.scannedAt().isAfter(lastScanAt))) ingest(scan);
        } catch (NoSuchFileException e) {
            // Not set up (or tests): nothing to do.
        } catch (Exception e) {
            log.warn("Presence scan unreadable: {}", e.getMessage());
        }
    }

    /** Record one scan: every device in it was on the network at {@code scannedAt}. */
    @Transactional
    public void ingest(Scan scan) {
        Instant at = scan.scannedAt();
        if (at.isAfter(clock.instant().plus(Duration.ofMinutes(2)))) {
            log.warn("Presence scan from the future ({}); ignoring it", at);
            return;
        }
        LocalDateTime seenAt = LocalDateTime.ofInstant(at, ZoneOffset.UTC);
        Map<String, String> seen = new LinkedHashMap<>(); // mac -> ip
        for (Seen s : scan.devices() == null ? List.<Seen>of() : scan.devices()) {
            if (seen.size() >= MAX_DEVICES) break;
            String mac = s.mac() == null ? "" : s.mac().trim().toLowerCase();
            if (!MAC.matcher(mac).matches()) continue;
            seen.put(mac, s.ip() != null && IPV4.matcher(s.ip()).matches() ? s.ip() : null);
        }
        Map<String, NetworkDevice> known = devices.findByMacIn(seen.keySet()).stream()
                .collect(Collectors.toMap(NetworkDevice::getMac, Function.identity()));
        List<NetworkDevice> changed = new ArrayList<>();
        seen.forEach((mac, ip) -> {
            NetworkDevice d = known.get(mac);
            if (d == null) {
                d = NetworkDevice.builder().mac(mac).firstSeen(seenAt).lastSeen(seenAt).presentSince(seenAt).build();
            } else {
                if (!seenAt.isAfter(d.getLastSeen())) return; // an older scan than one already applied
                if (d.getLastSeen().isBefore(seenAt.minus(awayAfter))) d.setPresentSince(seenAt);
                d.setLastSeen(seenAt);
            }
            if (ip != null) d.setIp(ip);
            changed.add(d);
        });
        devices.saveAll(changed);
        lastScanAt = at;
        lastScanCount = seen.size();
    }

    public PresenceResponse view() {
        Instant now = clock.instant();
        boolean online = lastScanAt != null && lastScanAt.isAfter(now.minus(SCANNER_STALE));
        Instant cutoff = now.minus(awayAfter);

        List<PresenceResponse.Device> rows = devices.findAll().stream()
                .map(d -> {
                    Instant last = d.getLastSeen().toInstant(ZoneOffset.UTC);
                    return new PresenceResponse.Device(d.getId(), d.getMac(), d.getIp(), d.getLabel(), d.getPerson(),
                            isPrivateAddress(d.getMac()), online ? !last.isBefore(cutoff) : null,
                            d.getFirstSeen().toInstant(ZoneOffset.UTC), last, d.getPresentSince().toInstant(ZoneOffset.UTC));
                })
                // Labeled first, then whatever's on the network now, newest sighting first.
                .sorted(Comparator.comparing((PresenceResponse.Device d) -> d.label() == null && d.person() == null)
                        .thenComparing(d -> !Boolean.TRUE.equals(d.home()))
                        .thenComparing(PresenceResponse.Device::lastSeen, Comparator.reverseOrder()))
                .toList();

        Map<String, List<PresenceResponse.Device>> byPerson = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (PresenceResponse.Device d : rows) {
            if (d.person() != null) byPerson.computeIfAbsent(d.person(), k -> new ArrayList<>()).add(d);
        }
        List<PresenceResponse.Person> people = byPerson.values().stream().map(ds -> {
            List<PresenceResponse.Device> here = ds.stream().filter(d -> Boolean.TRUE.equals(d.home())).toList();
            Instant lastSeen = ds.stream().map(PresenceResponse.Device::lastSeen).max(Comparator.naturalOrder()).orElse(null);
            Instant since = here.stream().map(PresenceResponse.Device::presentSince).min(Comparator.naturalOrder()).orElse(null);
            return new PresenceResponse.Person(ds.get(0).person(), online ? !here.isEmpty() : null, since, lastSeen, ds.size());
        }).toList();

        return new PresenceResponse(new PresenceResponse.Scanner(lastScanAt, online, lastScanCount),
                (int) awayAfter.toMinutes(), people, rows);
    }

    /** Name a device and say whose it is. Blank clears either. */
    @Transactional
    public void label(Long id, String label, String person) {
        NetworkDevice d = devices.findById(id).orElseThrow(() -> new NoSuchElementException("No such device"));
        d.setLabel(clean(label, 60, "label"));
        d.setPerson(clean(person, 40, "person"));
        devices.save(d);
    }

    /** Nightly at 3:50 AM CT: forget visitors' devices nobody labeled. */
    @Scheduled(cron = "0 50 3 * * *", zone = "America/Chicago")
    public void forgetOldVisitors() {
        int n = devices.deleteUnlabeledSeenBefore(LocalDateTime.now(clock.withZone(ZoneOffset.UTC)).minus(FORGET_UNLABELED));
        if (n > 0) log.info("Presence: forgot {} unlabeled devices not seen in {} days", n, FORGET_UNLABELED.toDays());
    }

    static boolean isPrivateAddress(String mac) {
        // Locally administered bit (0x02 of the first octet), which iOS/Android private addresses set.
        return mac != null && mac.length() >= 2 && (Integer.parseInt(mac.substring(0, 2), 16) & 0x02) != 0;
    }

    private static String clean(String v, int max, String field) {
        if (v == null || v.isBlank()) return null;
        String t = v.trim();
        if (t.length() > max) throw new IllegalArgumentException("'" + field + "' is limited to " + max + " characters");
        return t;
    }
}
