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
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
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

    /** {@code host}: the NUC's own LAN address, where the "Link this device" listener answers. */
    public record Scan(Instant scannedAt, String subnet, String host, List<Seen> devices) {}

    public record Seen(String mac, String ip, Boolean pinged) {}

    private final NetworkDeviceRepository devices;
    private final UserRepository users;
    private final ObjectMapper mapper;
    private final Path scanFile;
    private final Duration awayAfter;
    private final Clock clock;
    private volatile Instant lastScanAt;
    private volatile int lastScanCount;
    private volatile String hostIp;

    /** "Link this device": the listener's port on the NUC (scripts/presence-identify.ps1). */
    static final int IDENTIFY_PORT = 8099;
    /** How long a link waits for the device to open the listener's URL. */
    static final Duration IDENTIFY_TTL = Duration.ofMinutes(3);
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{22,64}$");
    private final SecureRandom random = new SecureRandom();
    private final Map<String, PendingLink> pendingLinks = new ConcurrentHashMap<>();

    private record PendingLink(Long userId, Instant expiresAt) {}

    /** A started link: open {@code url} on the device, on the home Wi-Fi. */
    public record LinkStart(String token, String url, Instant expiresAt) {}

    /** {@code status}: PENDING (not opened yet), EXPIRED, or LINKED with the device. */
    public record LinkStatus(String status, String name, String type, String mac) {}

    /** What the listener wrote: the device that opened the link. */
    record Identified(String ip, String mac, Instant at) {}

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
            seen.put(mac, validIp(s.ip()));
        }
        Map<String, NetworkDevice> known = devices.findByMacIn(seen.keySet()).stream()
                .collect(Collectors.toMap(NetworkDevice::getMac, Function.identity()));
        List<NetworkDevice> changed = new ArrayList<>();
        seen.forEach((mac, ip) -> {
            NetworkDevice d = known.get(mac);
            if (d != null && !seenAt.isAfter(d.getLastSeen())) return; // an older scan than one already applied
            changed.add(sighting(d, mac, ip, seenAt));
        });
        devices.saveAll(changed);
        lastScanAt = at;
        lastScanCount = seen.size();
        String host = validIp(scan.host());
        if (host != null) hostIp = host;
    }

    /** {@code mac} was on the network at {@code seenAt}: a new device, or a new stretch after being away. */
    private NetworkDevice sighting(NetworkDevice d, String mac, String ip, LocalDateTime seenAt) {
        if (d == null) {
            d = NetworkDevice.builder().mac(mac).firstSeen(seenAt).lastSeen(seenAt).presentSince(seenAt).build();
        } else if (seenAt.isAfter(d.getLastSeen())) {
            if (d.getLastSeen().isBefore(seenAt.minus(awayAfter))) d.setPresentSince(seenAt);
            d.setLastSeen(seenAt);
        }
        if (ip != null) d.setIp(ip);
        return d;
    }

    // ── "Link this device" ──

    /**
     * Start linking the device a member is using. They open the returned URL on it while
     * on the home Wi-Fi; the NUC's listener sees its LAN address (Docker hides it from
     * the backend) and records its MAC; {@link #checkLink} then makes it theirs.
     */
    public LinkStart startLink(Long userId) {
        Instant now = clock.instant();
        String host = hostIp;
        if (host == null || lastScanAt == null || lastScanAt.isBefore(now.minus(SCANNER_STALE))) {
            throw new IllegalStateException("Who's home isn't running on the NUC right now");
        }
        pendingLinks.values().removeIf(p -> p.expiresAt().isBefore(now));
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires = now.plus(IDENTIFY_TTL);
        pendingLinks.put(token, new PendingLink(userId, expires));
        return new LinkStart(token, "http://" + host + ":" + IDENTIFY_PORT + "/identify?t=" + token, expires);
    }

    /**
     * Finish a link once the device has opened its URL: the device becomes the member's,
     * and gets a type and a name from {@code userAgent} (the browser on that device) if
     * it has none. Only the member who started the link can finish it.
     */
    @Transactional
    public LinkStatus checkLink(Long userId, String token, String userAgent) {
        PendingLink pending = token == null || !TOKEN.matcher(token).matches() ? null : pendingLinks.get(token);
        if (pending == null || !pending.userId().equals(userId)) throw new NoSuchElementException("No such link");
        if (pending.expiresAt().isBefore(clock.instant())) {
            pendingLinks.remove(token);
            return new LinkStatus("EXPIRED", null, null, null);
        }
        Path file = scanFile.resolveSibling("identify").resolve(token + ".json");
        Identified found;
        try {
            found = mapper.readValue(Files.readAllBytes(file), Identified.class);
        } catch (NoSuchFileException e) {
            return new LinkStatus("PENDING", null, null, null);
        } catch (Exception e) {
            log.warn("Unreadable device link {}: {}", file.getFileName(), e.getMessage());
            return new LinkStatus("PENDING", null, null, null);
        }
        String mac = found.mac() == null ? "" : found.mac().trim().toLowerCase();
        if (!MAC.matcher(mac).matches()) throw new IllegalArgumentException("The NUC couldn't read this device's address");

        LocalDateTime seenAt = LocalDateTime.ofInstant(found.at() == null ? clock.instant() : found.at(), ZoneOffset.UTC);
        NetworkDevice known = devices.findByMacIn(List.of(mac)).stream().findFirst().orElse(null);
        NetworkDevice d = sighting(known, mac, validIp(found.ip()), seenAt);
        Guess guess = guessFromUserAgent(userAgent);
        if (d.getDeviceType() == null) d.setDeviceType(guess.type());
        if (d.getLabel() == null) {
            d.setLabel(users.findById(userId).map(u -> displayName(u) + "'s " + guess.kind()).orElse(null));
        }
        d.setOwnerUserId(userId);
        devices.save(d);
        pendingLinks.remove(token);
        return new LinkStatus("LINKED", d.getLabel(), d.getDeviceType().name(), d.getMac());
    }

    record Guess(NetworkDevice.DeviceType type, String kind) {}

    /** A device type, and a word for it, from the browser's User-Agent. iPadOS reports a Mac, so it reads as a computer. */
    static Guess guessFromUserAgent(String ua) {
        String u = ua == null ? "" : ua;
        if (u.contains("iPhone")) return new Guess(NetworkDevice.DeviceType.MOBILE, "iPhone");
        if (u.contains("iPad")) return new Guess(NetworkDevice.DeviceType.TABLET, "iPad");
        if (u.contains("Android")) {
            return u.contains("Mobile") ? new Guess(NetworkDevice.DeviceType.MOBILE, "phone")
                    : new Guess(NetworkDevice.DeviceType.TABLET, "tablet");
        }
        if (u.contains("Windows") || u.contains("Macintosh") || u.contains("CrOS") || u.contains("Linux")) {
            return new Guess(NetworkDevice.DeviceType.COMPUTER, "computer");
        }
        return new Guess(NetworkDevice.DeviceType.OTHER, "device");
    }

    private static String validIp(String ip) {
        return ip != null && IPV4.matcher(ip).matches() ? ip : null;
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

    /**
     * Everyone the house can track is away: the scanner is reporting, at least one
     * member has a phone or watch linked, and every such member is away. Members with no
     * phone or watch can't be known and aren't counted. False whenever it isn't sure.
     */
    public boolean everyoneAway() {
        PresenceResponse v = view();
        List<PresenceResponse.Person> tracked = v.people().stream().filter(p -> p.home() != null).toList();
        return v.scanner().online() && !tracked.isEmpty() && tracked.stream().noneMatch(PresenceResponse.Person::home);
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
