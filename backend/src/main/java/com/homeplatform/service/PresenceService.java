package com.homeplatform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.model.NetworkDevice;
import com.homeplatform.model.User;
import com.homeplatform.repository.NetworkDeviceRepository;
import com.homeplatform.repository.UserRepository;
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
 * {@code awayAfterMinutes} without being seen. A member is home while one of their
 * phones or watches is; computers, TVs and the like don't count, since they stay home.
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
    private final UserRepository users;
    private final ObjectMapper mapper;
    private final Path scanFile;
    private final Duration awayAfter;
    private final Clock clock;
    private volatile Instant lastScanAt;
    private volatile int lastScanCount;

    @Autowired
    public PresenceService(NetworkDeviceRepository devices, UserRepository users, ObjectMapper mapper,
                           @Value("${app.presence.scan-file:/presence/scan.json}") String scanFile,
                           @Value("${app.presence.away-after-minutes:15}") int awayAfterMinutes) {
        this(devices, users, mapper, Path.of(scanFile), Duration.ofMinutes(awayAfterMinutes), Clock.systemUTC());
    }

    PresenceService(NetworkDeviceRepository devices, UserRepository users, ObjectMapper mapper, Path scanFile,
                    Duration awayAfter, Clock clock) {
        this.devices = devices;
        this.users = users;
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

        List<User> memberUsers = members();
        Map<Long, String> names = new HashMap<>();
        for (User u : users.findAll()) names.put(u.getId(), displayName(u));

        List<NetworkDevice> all = devices.findAll();
        List<PresenceResponse.Device> rows = all.stream()
                .map(d -> {
                    Instant last = d.getLastSeen().toInstant(ZoneOffset.UTC);
                    return new PresenceResponse.Device(d.getId(), d.getMac(), d.getIp(), d.getLabel(),
                            d.getDeviceType() == null ? null : d.getDeviceType().name(),
                            d.getOwnerUserId(), d.getOwnerUserId() == null ? null : names.get(d.getOwnerUserId()),
                            isPrivateAddress(d.getMac()), online ? !last.isBefore(cutoff) : null,
                            d.getFirstSeen().toInstant(ZoneOffset.UTC), last, d.getPresentSince().toInstant(ZoneOffset.UTC));
                })
                // Labeled first, then whatever's on the network now, newest sighting first.
                .sorted(Comparator.comparing((PresenceResponse.Device d) -> !isLabeled(d))
                        .thenComparing(d -> !Boolean.TRUE.equals(d.home()))
                        .thenComparing(PresenceResponse.Device::lastSeen, Comparator.reverseOrder()))
                .toList();

        // One card per member who owns a device, in member order.
        Map<Long, List<PresenceResponse.Device>> byOwner = new LinkedHashMap<>();
        for (PresenceResponse.Device d : rows) {
            if (d.ownerUserId() != null) byOwner.computeIfAbsent(d.ownerUserId(), k -> new ArrayList<>()).add(d);
        }
        List<PresenceResponse.Person> people = byOwner.entrySet().stream()
                .sorted(Comparator.comparing(e -> e.getKey()))
                .map(e -> {
                    List<PresenceResponse.Device> ds = e.getValue();
                    List<PresenceResponse.Device> counted = ds.stream().filter(PresenceService::counts).toList();
                    List<PresenceResponse.Device> here = counted.stream().filter(d -> Boolean.TRUE.equals(d.home())).toList();
                    Instant lastSeen = counted.stream().map(PresenceResponse.Device::lastSeen).max(Comparator.naturalOrder()).orElse(null);
                    Instant since = here.stream().map(PresenceResponse.Device::presentSince).min(Comparator.naturalOrder()).orElse(null);
                    // No phone or watch: nothing says where they are.
                    Boolean home = !online || counted.isEmpty() ? null : !here.isEmpty();
                    return new PresenceResponse.Person(e.getKey(), names.getOrDefault(e.getKey(), "Member " + e.getKey()),
                            home, since, lastSeen, ds.size());
                })
                .toList();

        return new PresenceResponse(new PresenceResponse.Scanner(lastScanAt, online, lastScanCount),
                (int) awayAfter.toMinutes(), people, rows,
                memberUsers.stream().map(u -> new PresenceResponse.Member(u.getId(), displayName(u))).toList());
    }

    /** Name a device, set its type and its owner (a member's id, or null). Blank clears the name. */
    @Transactional
    public void label(Long id, String name, String type, Long ownerUserId) {
        NetworkDevice d = devices.findById(id).orElseThrow(() -> new NoSuchElementException("No such device"));
        d.setLabel(clean(name, 60, "name"));
        d.setDeviceType(parseType(type));
        if (ownerUserId != null && members().stream().noneMatch(u -> u.getId().equals(ownerUserId))) {
            throw new IllegalArgumentException("The owner must be an active member");
        }
        d.setOwnerUserId(ownerUserId);
        devices.save(d);
    }

    /** Who a device can belong to: active admins and members, not guests. */
    private List<User> members() {
        return users.findByStatus(User.AccountStatus.ACTIVE).stream()
                .filter(u -> u.getRole() != User.Role.GUEST)
                .sorted(Comparator.comparing(User::getId))
                .toList();
    }

    private static String displayName(User u) {
        return u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName();
    }

    private static boolean isLabeled(PresenceResponse.Device d) {
        return d.name() != null || d.type() != null || d.ownerUserId() != null;
    }

    private static boolean counts(PresenceResponse.Device d) {
        return d.type() != null && NetworkDevice.DeviceType.valueOf(d.type()).countsTowardPresence();
    }

    private static NetworkDevice.DeviceType parseType(String type) {
        if (type == null || type.isBlank()) return null;
        try {
            return NetworkDevice.DeviceType.valueOf(type.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown device type: " + type);
        }
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
