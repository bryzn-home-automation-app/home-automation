package com.homeplatform.homeassistant;

import com.homeplatform.dto.CameraBatteryHistoryResponse;
import com.homeplatform.dto.CameraBatteryReadingResponse;
import com.homeplatform.dto.CameraLiveResponse;
import com.homeplatform.dto.CameraResponse;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.CameraBatteryReadingRepository;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The app-facing camera API behind {@code /api/home/cameras}: listing with battery and
 * motion state, battery history, proxied snapshots, and live-view tickets. HA entity
 * IDs and go2rtc stream names never leave this layer.
 */
@Service
public class CameraService {

    static final Duration DEFAULT_HISTORY = Duration.ofHours(24);
    static final Duration MAX_HISTORY = Duration.ofDays(93);
    /**
     * Several viewers opening the page share one fetch: each snapshot can make the
     * bridge wake a battery camera.
     */
    static final Duration SNAPSHOT_CACHE = Duration.ofSeconds(20);
    /**
     * An older still is served instantly and refreshed in the background, unless a
     * motion/person event happened since it was taken (then the viewer waits for the
     * new frame). A cold E30 still took ~4 s while the bridge grabbed a live frame.
     */
    static final Duration SNAPSHOT_STALE_OK = Duration.ofMinutes(20);

    private static final Logger log = LoggerFactory.getLogger(CameraService.class);
    static final String LIVE_PATH = "/camera-stream/";

    private final HomeAssistantService ha;
    private final SmartDeviceRepository deviceRepo;
    private final CameraStatusRepository statusRepo;
    private final CameraBatteryReadingRepository readingRepo;
    private final CameraStreamTickets tickets;
    private final double latitude;
    private final double longitude;
    private final Clock clock;
    private final Map<Long, CachedImage> snapshots = new ConcurrentHashMap<>();
    private final Set<Long> refreshing = ConcurrentHashMap.newKeySet();
    private final ExecutorService refresher = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "camera-snapshot-refresh");
        t.setDaemon(true);
        return t;
    });

    private record CachedImage(Instant at, HomeAssistantClient.CameraImage image) {}

    @Autowired
    public CameraService(HomeAssistantService ha,
                         SmartDeviceRepository deviceRepo,
                         CameraStatusRepository statusRepo,
                         CameraBatteryReadingRepository readingRepo,
                         CameraStreamTickets tickets,
                         @Value("${app.property-latitude:0}") double latitude,
                         @Value("${app.property-longitude:0}") double longitude) {
        this(ha, deviceRepo, statusRepo, readingRepo, tickets, latitude, longitude, Clock.systemUTC());
    }

    CameraService(HomeAssistantService ha, SmartDeviceRepository deviceRepo, CameraStatusRepository statusRepo,
                  CameraBatteryReadingRepository readingRepo, CameraStreamTickets tickets,
                  double latitude, double longitude, Clock clock) {
        this.ha = ha;
        this.deviceRepo = deviceRepo;
        this.statusRepo = statusRepo;
        this.readingRepo = readingRepo;
        this.tickets = tickets;
        this.latitude = latitude;
        this.longitude = longitude;
        this.clock = clock;
    }

    public List<CameraResponse> listCameras() {
        requireConfigured();
        return deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA).stream()
                .map(this::toCamera)
                .toList();
    }

    public CameraBatteryHistoryResponse batteryHistory(String id, Instant from, Instant to) {
        requireConfigured();
        SmartDevice d = camera(id);
        Instant end = to != null ? to : clock.instant();
        Instant start = from != null ? from : end.minus(DEFAULT_HISTORY);
        if (!start.isBefore(end)) throw new IllegalArgumentException("'from' must be before 'to'");
        if (Duration.between(start, end).compareTo(MAX_HISTORY) > 0) {
            throw new IllegalArgumentException("History range is limited to " + MAX_HISTORY.toDays() + " days");
        }
        List<CameraBatteryReadingResponse> readings = readingRepo
                .findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(d.getId(), utc(start), utc(end)).stream()
                .map(r -> new CameraBatteryReadingResponse(iso(r.getRecordedAt()), r.getBatteryPercent(),
                        r.getCharging(), r.getChargingStatus()))
                .toList();
        List<CameraBatteryHistoryResponse.Window> daylight = SunCalculator.daylight(start, end, latitude, longitude)
                .stream()
                .map(w -> new CameraBatteryHistoryResponse.Window(w.from().toString(), w.to().toString()))
                .toList();
        return new CameraBatteryHistoryResponse(readings, daylight);
    }

    public HomeAssistantClient.CameraImage snapshot(String id) {
        requireConfigured();
        SmartDevice d = camera(id);
        Instant now = clock.instant();
        CachedImage hit = snapshots.get(d.getId());
        if (hit != null) {
            if (hit.at().plus(SNAPSHOT_CACHE).isAfter(now)) return hit.image();
            if (hit.at().plus(SNAPSHOT_STALE_OK).isAfter(now) && !eventSince(d, hit.at())) {
                refreshInBackground(d);
                return hit.image();
            }
        }
        return fetchSnapshot(d);
    }

    /**
     * Keep wired cameras' stills warm (called from the 15-minute HA snapshot) so the
     * first view of the tab is instant. Battery cameras are left alone: their stills
     * come from the last event, and asking for more could wake them.
     */
    public void prewarmSnapshots() {
        if (!ha.isActive()) return;
        for (SmartDevice d : deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)) {
            statusRepo.findByDeviceId(d.getId())
                    .filter(st -> st.isAvailable() && CameraStatus.POWER_WIRED.equals(st.getPowerSource()))
                    .ifPresent(st -> refreshInBackground(d));
        }
    }

    private HomeAssistantClient.CameraImage fetchSnapshot(SmartDevice d) {
        HomeAssistantClient.CameraImage img = ImageScaler.fit(ha.cameraSnapshot(d), ImageScaler.MAX_WIDTH);
        snapshots.put(d.getId(), new CachedImage(clock.instant(), img));
        return img;
    }

    private void refreshInBackground(SmartDevice d) {
        if (!refreshing.add(d.getId())) return; // one refresh per camera at a time
        refresher.execute(() -> {
            try {
                fetchSnapshot(d);
            } catch (Exception e) {
                log.debug("Background snapshot refresh failed for camera {}: {}", d.getId(), e.getMessage());
            } finally {
                refreshing.remove(d.getId());
            }
        });
    }

    /** A motion/person event newer than the cached still: the viewer should see the new frame. */
    private boolean eventSince(SmartDevice d, Instant at) {
        LocalDateTime since = utc(at);
        return statusRepo.findByDeviceId(d.getId())
                .map(st -> isAfter(st.getLastMotionAt(), since) || isAfter(st.getLastPersonAt(), since))
                .orElse(false);
    }

    private static boolean isAfter(LocalDateTime t, LocalDateTime since) {
        return t != null && t.isAfter(since);
    }

    /** A ticketed live-view URL. 422 when the camera has no stream (not via eufy-sdk). */
    public CameraLiveResponse startLive(String id) {
        requireConfigured();
        SmartDevice d = camera(id);
        String stream = statusRepo.findByDeviceId(d.getId()).map(CameraStatus::getStreamName).orElse(null);
        if (stream == null) throw new HomeDeviceService.Unsupported("Live view isn't available for this camera", false);
        CameraStreamTickets.Ticket t = tickets.issue(d.getPublicId());
        return new CameraLiveResponse(LIVE_PATH + t.value() + "/ws", t.expiresAt().toString());
    }

    /**
     * For nginx's {@code auth_request}: the go2rtc stream a ticket opens, or empty when
     * the ticket is invalid/expired or the camera is gone or disabled.
     */
    public Optional<String> streamForTicket(String ticket) {
        return tickets.verify(ticket)
                .flatMap(deviceRepo::findByPublicId)
                .filter(SmartDevice::isEnabled)
                .filter(d -> d.getKind() == SmartDevice.Kind.CAMERA)
                .flatMap(d -> statusRepo.findByDeviceId(d.getId()))
                .map(CameraStatus::getStreamName);
    }

    // ── helpers ──

    private void requireConfigured() {
        if (!ha.isActive()) throw new HomeAssistantException.Unavailable("Home Assistant integration is not configured");
    }

    private SmartDevice camera(String id) {
        UUID publicId;
        try {
            publicId = UUID.fromString(id);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new HomeDeviceService.NotFound();
        }
        return deviceRepo.findByPublicId(publicId)
                .filter(SmartDevice::isEnabled)
                .filter(d -> d.getKind() == SmartDevice.Kind.CAMERA)
                .orElseThrow(HomeDeviceService.NotFound::new);
    }

    private CameraResponse toCamera(SmartDevice d) {
        CameraStatus st = statusRepo.findByDeviceId(d.getId()).orElse(null);
        if (st == null) {
            return new CameraResponse(d.getPublicId().toString(), d.getName(), true, null,
                    null, null, null, null, null, null, false, iso(d.getLastSeenAt()));
        }
        boolean battery = CameraStatus.POWER_BATTERY.equals(st.getPowerSource());
        return new CameraResponse(
                d.getPublicId().toString(), d.getName(), st.isAvailable(), st.getPowerSource(),
                battery ? st.getBatteryPercent() : null,
                battery ? st.getCharging() : null,
                battery ? st.getChargingStatus() : null,
                battery ? iso(st.getBatteryUpdatedAt()) : null,
                iso(st.getLastMotionAt()), iso(st.getLastPersonAt()),
                st.getStreamName() != null, iso(d.getLastSeenAt()));
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static String iso(LocalDateTime t) {
        return t == null ? null : t.toInstant(ZoneOffset.UTC).toString();
    }
}
