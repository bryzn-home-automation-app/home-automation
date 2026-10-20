package com.homeplatform.homeassistant;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.model.CameraBatteryReading;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.User;
import com.homeplatform.repository.CameraBatteryReadingRepository;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.NotificationRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.NotificationService;
import com.homeplatform.service.WeatherService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * CAMERA notifications for every active member (guests never get them):
 * <ul>
 *   <li><b>Battery low</b> (WARNING, ≤ {@value #BATTERY_LOW}%) and <b>battery critical</b>
 *       (CRITICAL, ≤ {@value #BATTERY_CRITICAL}%) while not charging — once per camera per
 *       day, so a persistent low battery reminds daily.</li>
 *   <li><b>Not charging</b> (WARNING) — a solar camera below {@value #NOT_CHARGING_BELOW}%
 *       gained no charge over the last two days although both were sunny (WMO weather
 *       code ≤ 2). Points at a dirty, shaded or unplugged panel. Once per day.</li>
 *   <li><b>Offline</b> (WARNING) — a camera unavailable for {@link #OFFLINE_AFTER}; when
 *       every camera is offline it's one "cameras disconnected" alert instead, since that
 *       usually means the eufy bridge was signed out. Once per day.</li>
 *   <li><b>Person detected</b> (INFO) — outdoor (battery) cameras only, real time, at most
 *       one per camera per {@link #PERSON_COOLDOWN}. The indoor camera sees the household
 *       all day, so it's left to the eufy app.</li>
 * </ul>
 * {@link #evaluate()} runs from the 15-minute HA snapshot; {@link #personDetected} from
 * live ingestion. Dedupe is by title against the notifications table, so restarts don't
 * re-alert.
 */
@Service
public class CameraAlertService {

    private static final Logger log = LoggerFactory.getLogger(CameraAlertService.class);

    static final int BATTERY_LOW = 30;
    static final int BATTERY_CRITICAL = 15;
    static final int NOT_CHARGING_BELOW = 90;
    static final Duration NOT_CHARGING_WINDOW = Duration.ofHours(48);
    static final Duration OFFLINE_AFTER = Duration.ofMinutes(30);
    static final Duration PERSON_COOLDOWN = Duration.ofMinutes(15);
    /** Clear, mainly clear, partly cloudy (WMO codes 0–2). */
    static final int SUNNY_MAX_WEATHER_CODE = 2;
    private static final DateTimeFormatter CLOCK_TIME = DateTimeFormatter.ofPattern("h:mm a");

    private final SmartDeviceRepository deviceRepo;
    private final CameraStatusRepository statusRepo;
    private final CameraBatteryReadingRepository readingRepo;
    private final NotificationRepository notificationRepo;
    private final NotificationService notifications;
    private final UserRepository users;
    private final WeatherService weather;
    private final double latitude;
    private final double longitude;
    private final Clock clock;
    /** "Were the two days before {key} both sunny?" — one weather lookup per day. */
    private final Map<LocalDate, Boolean> sunnyCache = new ConcurrentHashMap<>();

    @Autowired
    public CameraAlertService(SmartDeviceRepository deviceRepo,
                              CameraStatusRepository statusRepo,
                              CameraBatteryReadingRepository readingRepo,
                              NotificationRepository notificationRepo,
                              NotificationService notifications,
                              UserRepository users,
                              WeatherService weather,
                              @Value("${app.property-latitude:0}") double latitude,
                              @Value("${app.property-longitude:0}") double longitude) {
        this(deviceRepo, statusRepo, readingRepo, notificationRepo, notifications, users, weather,
                latitude, longitude, Clock.system(ZoneId.of("America/Chicago")));
    }

    CameraAlertService(SmartDeviceRepository deviceRepo, CameraStatusRepository statusRepo,
                       CameraBatteryReadingRepository readingRepo, NotificationRepository notificationRepo,
                       NotificationService notifications, UserRepository users, WeatherService weather,
                       double latitude, double longitude, Clock clock) {
        this.deviceRepo = deviceRepo;
        this.statusRepo = statusRepo;
        this.readingRepo = readingRepo;
        this.notificationRepo = notificationRepo;
        this.notifications = notifications;
        this.users = users;
        this.weather = weather;
        this.latitude = latitude;
        this.longitude = longitude;
        this.clock = clock;
    }

    /** Battery, not-charging and offline checks across all enabled cameras. Never throws. */
    public void evaluate() {
        try {
            List<Camera> cams = new ArrayList<>();
            for (SmartDevice d : deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)) {
                statusRepo.findByDeviceId(d.getId()).ifPresent(st -> cams.add(new Camera(d, st)));
            }
            if (cams.isEmpty()) return;
            List<Long> recipients = recipients();
            if (recipients.isEmpty()) return;
            offline(cams, recipients);
            for (Camera c : cams) {
                if (!c.status().isAvailable() || !battery(c.status())) continue;
                batteryLevel(c, recipients);
                notCharging(c, recipients);
            }
        } catch (Exception e) {
            log.warn("Camera alert evaluation failed: {}", e.getMessage());
        }
    }

    /** A new person detection on {@code device}. Never throws. */
    public void personDetected(SmartDevice device, CameraStatus st) {
        try {
            if (!battery(st)) return; // outdoor (battery) cameras only — see class doc
            String title = "Person detected — " + device.getName();
            LocalDateTime since = now().minus(PERSON_COOLDOWN);
            for (Long user : recipients()) {
                if (notificationRepo.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(user, Category.CAMERA, title, since)) {
                    continue;
                }
                notifications.create(user, Category.CAMERA, Severity.INFO, title,
                        "Someone was seen by the " + device.getName() + " camera at "
                                + now().format(CLOCK_TIME) + ". Open Cameras to look.");
            }
        } catch (Exception e) {
            log.warn("Person alert failed: {}", e.getMessage());
        }
    }

    // ── checks ──

    private void batteryLevel(Camera c, List<Long> recipients) {
        CameraStatus st = c.status();
        Double pct = st.getBatteryPercent();
        if (pct == null || Boolean.TRUE.equals(st.getCharging())) return;
        String name = c.device().getName();
        int level = (int) Math.round(pct);
        if (pct <= BATTERY_CRITICAL) {
            sendDaily(recipients, Severity.CRITICAL, name + " camera battery critical",
                    "Battery at " + level + "%. It will go offline soon — charge it or check the solar panel.");
        } else if (pct <= BATTERY_LOW) {
            sendDaily(recipients, Severity.WARNING, name + " camera battery low",
                    "Battery at " + level + "% and not charging.");
        }
    }

    private void notCharging(Camera c, List<Long> recipients) {
        CameraStatus st = c.status();
        if (st.getBatteryPercent() == null || st.getBatteryPercent() >= NOT_CHARGING_BELOW) return;
        if (Boolean.TRUE.equals(st.getCharging())) return;
        String title = c.device().getName() + " camera isn't charging";
        if (alreadySentToday(recipients, title)) return; // skip the readings + weather work

        LocalDateTime end = utcNow();
        List<CameraBatteryReading> rs = readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(
                st.getDeviceId(), end.minus(NOT_CHARGING_WINDOW), end);
        if (!coversWindow(rs, end) || gainedCharge(rs)) return;
        if (!lastTwoDaysSunny()) return;
        sendDaily(recipients, Severity.WARNING, title,
                "No solar charge in the last two sunny days (battery " + Math.round(st.getBatteryPercent())
                        + "%). Check that the panel is plugged in, clean and not shaded.");
    }

    private void offline(List<Camera> cams, List<Long> recipients) {
        LocalDateTime cutoff = utcNow().minus(OFFLINE_AFTER);
        List<Camera> down = cams.stream()
                .filter(c -> !c.status().isAvailable() && c.status().getUnavailableSince() != null
                        && !c.status().getUnavailableSince().isAfter(cutoff))
                .toList();
        if (down.isEmpty()) return;
        if (down.size() == cams.size() && cams.size() > 1) {
            sendDaily(recipients, Severity.WARNING, "Eufy cameras disconnected",
                    "All cameras have been offline for over " + OFFLINE_AFTER.toMinutes() + " minutes. The eufy bridge "
                            + "may have been signed out (for example by signing into its account in the eufy app) — "
                            + "check Home Assistant for a re-authentication prompt.");
            return;
        }
        for (Camera c : down) {
            sendDaily(recipients, Severity.WARNING, c.device().getName() + " camera offline",
                    "Offline for over " + OFFLINE_AFTER.toMinutes() + " minutes"
                            + (battery(c.status()) ? " — the battery may be empty or the HomeBase out of range." : "."));
        }
    }

    // ── helpers ──

    /** History reaches back (almost) the whole window — a new camera isn't "not charging". */
    static boolean coversWindow(List<CameraBatteryReading> rs, LocalDateTime end) {
        return !rs.isEmpty() && !rs.get(0).getRecordedAt().isAfter(end.minus(NOT_CHARGING_WINDOW).plusHours(2));
    }

    /** Reported charging at any point, or the level rose between any two readings. */
    static boolean gainedCharge(List<CameraBatteryReading> rs) {
        for (int i = 0; i < rs.size(); i++) {
            if (Boolean.TRUE.equals(rs.get(i).getCharging())) return true;
            if (i > 0 && rs.get(i).getBatteryPercent() > rs.get(i - 1).getBatteryPercent()) return true;
        }
        return false;
    }

    /**
     * Both full days before today were sunny. Unknown weather (no location, API down)
     * counts as not sunny — better a missed warning than a false one.
     */
    boolean lastTwoDaysSunny() {
        if (latitude == 0 && longitude == 0) return false;
        LocalDate today = LocalDate.now(clock);
        return sunnyCache.computeIfAbsent(today, t -> {
            try {
                WeatherResponse w = weather.getWeatherForDateRange(latitude, longitude, t.minusDays(2), t.minusDays(1));
                List<WeatherResponse.WeatherDay> days = w == null || w.daily() == null ? List.of() : w.daily().stream()
                        .filter(d -> d.date().equals(t.minusDays(2).toString()) || d.date().equals(t.minusDays(1).toString()))
                        .toList();
                return days.size() == 2 && days.stream().allMatch(d -> d.weatherCode() <= SUNNY_MAX_WEATHER_CODE);
            } catch (Exception e) {
                log.debug("Weather lookup for camera alerts failed: {}", e.getMessage());
                return false;
            }
        });
    }

    private void sendDaily(List<Long> recipients, Severity severity, String title, String message) {
        LocalDateTime startOfDay = LocalDate.now(clock).atStartOfDay();
        for (Long user : recipients) {
            if (notificationRepo.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(user, Category.CAMERA, title, startOfDay)) {
                continue;
            }
            log.info("Camera alert: {} — {}", severity, title);
            notifications.create(user, Category.CAMERA, severity, title, message);
        }
    }

    private boolean alreadySentToday(List<Long> recipients, String title) {
        LocalDateTime startOfDay = LocalDate.now(clock).atStartOfDay();
        return recipients.stream().allMatch(u ->
                notificationRepo.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(u, Category.CAMERA, title, startOfDay));
    }

    /** Active members — cameras are members-only, so guests never get these. */
    private List<Long> recipients() {
        return users.findByStatus(User.AccountStatus.ACTIVE).stream()
                .filter(u -> u.getRole() != User.Role.GUEST)
                .map(User::getId)
                .filter(Objects::nonNull)
                .toList();
    }

    private static boolean battery(CameraStatus st) {
        return CameraStatus.POWER_BATTERY.equals(st.getPowerSource());
    }

    /** Local wall time — what notifications.created_at holds. */
    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    /** UTC — what camera_status / readings hold. */
    private LocalDateTime utcNow() {
        return LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
    }

    private record Camera(SmartDevice device, CameraStatus status) {}
}
