package com.homeplatform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.WeatherAlertPreview;
import com.homeplatform.dto.WeatherAlertResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.model.WeatherAlertLog;
import com.homeplatform.model.WeatherAlertSetting;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.repository.WeatherAlertLogRepository;
import com.homeplatform.repository.WeatherAlertSettingRepository;
import com.homeplatform.service.WeatherAlertRule.Alert;
import com.homeplatform.service.WeatherAlertRule.Hour;
import com.homeplatform.service.WeatherAlertRule.Verdict;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Weather alerts for members who turned them on (Profile → Weather alerts). Each forecast
 * alert is checked once a day at the member's own time against the hourly Open-Meteo
 * forecast for home ({@link WeatherAlertRule}); official National Weather Service warnings
 * are passed on as they're issued. Every check is logged so it runs once, even across a
 * restart, and a check missed while the server was down still runs if it's back within
 * {@link #GRACE}.
 */
@Service
public class WeatherAlertService {

    private static final Logger log = LoggerFactory.getLogger(WeatherAlertService.class);

    public static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    static final Duration GRACE = Duration.ofHours(2);
    private static final Duration FORECAST_TTL = Duration.ofMinutes(15);
    private static final Duration WARNINGS_TTL = Duration.ofMinutes(1);
    private static final String FORECAST_URL = "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
            + "&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_gusts_10m,snowfall"
            + "&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph"
            + "&timezone=America/Chicago&forecast_days=3";
    private static final String WARNINGS_URL = "https://api.weather.gov/alerts/active?point=%.4f,%.4f";
    /** weather.gov refuses requests without one. */
    private static final String USER_AGENT = "HomeOS home dashboard (weather alerts)";
    private static final int MESSAGE_MAX = 900;
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final ObjectMapper mapper = new ObjectMapper();

    /** An active National Weather Service alert for home. */
    public record Warning(String id, List<String> references, String event, String headline,
                          String instruction, String severity, String messageType, String status) {
        /** 1 for a warning (or emergency), 2 for a watch, 3 for anything else (advisories, statements). */
        int level() {
            String e = event == null ? "" : event;
            if (e.contains("Warning") || e.contains("Emergency")) return 1;
            if (e.contains("Watch")) return 2;
            return 3;
        }

        boolean actionable() {
            return "Actual".equalsIgnoreCase(status) && !"Cancel".equalsIgnoreCase(messageType);
        }
    }

    /** A member's settings for one rule, with the defaults filled in. */
    record Resolved(LocalTime checkAt, LocalTime until, int threshold) {}

    /** A settings change; null fields are left as they are. */
    public record Change(Boolean inApp, Boolean push, LocalTime checkAt, LocalTime until, Integer threshold) {}

    private record Cached<T>(Instant at, T value) {}

    private final WeatherAlertSettingRepository settings;
    private final WeatherAlertLogRepository checks;
    private final NotificationService notifications;
    private final NotificationPreferenceService preferences;
    private final UserRepository users;
    private final RestTemplate http;
    private final double latitude;
    private final double longitude;
    private volatile Cached<List<Hour>> forecastCache;
    private volatile Cached<List<Warning>> warningsCache;

    public WeatherAlertService(WeatherAlertSettingRepository settings, WeatherAlertLogRepository checks,
                               NotificationService notifications, NotificationPreferenceService preferences,
                               UserRepository users, RestTemplate http,
                               @Value("${app.property-latitude:0}") double latitude,
                               @Value("${app.property-longitude:0}") double longitude) {
        this.settings = settings;
        this.checks = checks;
        this.notifications = notifications;
        this.preferences = preferences;
        this.users = users;
        this.http = http;
        this.latitude = latitude;
        this.longitude = longitude;
    }

    // ── Settings ──

    /** Every weather alert, in display order, with this member's settings. */
    public List<WeatherAlertResponse> list(Long userId) {
        Map<AlertType, WeatherAlertSetting> mine = settings.findByUserId(userId).stream()
                .collect(Collectors.toMap(WeatherAlertSetting::getAlertType, Function.identity(), (a, b) -> a));
        return Arrays.stream(WeatherAlertRule.values()).map(r -> response(userId, r, mine.get(r.type()))).toList();
    }

    @Transactional
    public WeatherAlertResponse update(Long userId, WeatherAlertRule rule, Change change) {
        if (change.inApp() != null || change.push() != null) {
            NotificationPreferenceService.Effective now = preferences.effective(userId, rule.type());
            preferences.update(userId, rule.type(),
                    change.inApp() != null ? change.inApp() : now.inApp(),
                    change.push() != null ? change.push() : now.push());
        }
        Optional<WeatherAlertSetting> existing = settings.findByUserIdAndAlertType(userId, rule.type());
        if (change.checkAt() != null || change.until() != null || change.threshold() != null) {
            WeatherAlertSetting s = existing.orElseGet(() ->
                    WeatherAlertSetting.builder().userId(userId).alertType(rule.type()).build());
            if (change.checkAt() != null) s.setCheckAt(change.checkAt());
            if (change.until() != null) s.setUntil(change.until());
            if (change.threshold() != null) s.setThreshold(change.threshold());
            s.setUpdatedAt(LocalDateTime.now());
            existing = Optional.of(settings.save(s));
        }
        return response(userId, rule, existing.orElse(null));
    }

    private WeatherAlertResponse response(Long userId, WeatherAlertRule rule, WeatherAlertSetting s) {
        NotificationPreferenceService.Effective pref = preferences.effective(userId, rule.type());
        Resolved v = resolve(rule, s);
        return new WeatherAlertResponse(rule.type().name(), rule.type().label(), rule.type().description(),
                pref.inApp(), pref.push(), rule.scheduled(),
                v.checkAt() == null ? null : v.checkAt().format(HH_MM),
                v.until() == null ? null : v.until().format(HH_MM),
                rule.defaultThreshold() == null ? null : v.threshold(),
                rule.thresholdLabel(), rule.options());
    }

    Resolved resolve(Long userId, WeatherAlertRule rule) {
        return resolve(rule, settings.findByUserIdAndAlertType(userId, rule.type()).orElse(null));
    }

    private static Resolved resolve(WeatherAlertRule rule, WeatherAlertSetting s) {
        LocalTime checkAt = s != null && s.getCheckAt() != null ? s.getCheckAt() : rule.defaultCheckAt();
        LocalTime until = s != null && s.getUntil() != null ? s.getUntil() : rule.defaultUntil();
        Integer t = s != null && s.getThreshold() != null && rule.allows(s.getThreshold()) ? s.getThreshold() : rule.defaultThreshold();
        return new Resolved(checkAt, until, t == null ? 0 : t);
    }

    // ── Preview ──

    /** What this alert would say from the forecast right now, for the next check. Throws when the forecast can't be reached. */
    public WeatherAlertPreview preview(Long userId, WeatherAlertRule rule, LocalDateTime now) {
        Resolved v = resolve(userId, rule);
        if (!rule.scheduled()) {
            List<Warning> active = warnings().stream()
                    .filter(Warning::actionable)
                    .filter(w -> w.level() <= v.threshold())
                    .toList();
            String when = "As soon as they're issued";
            if (active.isEmpty()) return new WeatherAlertPreview(when, null, null, null, null, "None in effect for home right now.");
            Alert a = warningAlert(active.get(0));
            return new WeatherAlertPreview(when, null, a.severity().name(), a.title(), a.message(),
                    active.size() + " in effect for home right now.");
        }
        LocalDateTime next = now.toLocalDate().atTime(v.checkAt());
        if (next.isBefore(now.withSecond(0).withNano(0))) next = next.plusDays(1);
        LocalDateTime end = WeatherAlertRule.windowEnd(next, v.until());
        Verdict verdict = rule.check(forecast(), next, end, v.threshold());
        String day = !next.toLocalDate().equals(now.toLocalDate()) ? "Tomorrow" : next.getHour() >= 17 ? "Tonight" : "Today";
        String when = day + " at " + WeatherAlertRule.clockTime(next.toLocalTime());
        String hours = WeatherAlertRule.clockTime(next.toLocalTime()) + " – " + WeatherAlertRule.clockTime(end.toLocalTime());
        Alert a = verdict.alert();
        return a == null
                ? new WeatherAlertPreview(when, hours, null, null, null, verdict.summary() + ".")
                : new WeatherAlertPreview(when, hours, a.severity().name(), a.title(), a.message(), verdict.summary() + ".");
    }

    // ── Checks ──

    /** Each member's daily forecast checks that are due. Returns how many alerts went out. */
    public int runScheduled(LocalDateTime now) {
        int sent = 0;
        try {
            for (WeatherAlertRule rule : WeatherAlertRule.values()) {
                if (!rule.scheduled()) continue;
                for (Long userId : recipients(rule.type())) {
                    Resolved v = resolve(userId, rule);
                    LocalDateTime due = due(now, v.checkAt());
                    if (due == null) continue;
                    String key = due.toString();
                    if (checks.existsByUserIdAndAlertTypeAndAlertKey(userId, rule.type(), key)) continue;
                    Verdict verdict = rule.check(forecast(), due, WeatherAlertRule.windowEnd(due, v.until()), v.threshold());
                    Alert a = verdict.alert();
                    boolean alerted = a != null
                            && notifications.send(userId, rule.type(), a.severity(), a.title(), a.message()) != null;
                    record(userId, rule.type(), key, alerted);
                    if (alerted) {
                        sent++;
                        log.info("Weather alert {} for user {}: {}", rule, userId, a.title());
                    }
                }
            }
        } catch (RuntimeException e) {
            // Nothing is logged for the checks that didn't run, so the next tick retries them.
            log.warn("Weather alert checks stopped: {}", e.getMessage());
        }
        return sent;
    }

    /** The check at {@code checkAt} that's due now (today's, or late last night's), within {@link #GRACE}; else null. */
    static LocalDateTime due(LocalDateTime now, LocalTime checkAt) {
        for (LocalDateTime c : List.of(now.toLocalDate().atTime(checkAt), now.toLocalDate().minusDays(1).atTime(checkAt))) {
            if (!now.isBefore(c) && now.isBefore(c.plus(GRACE))) return c;
        }
        return null;
    }

    /** New National Weather Service warnings, to members who want them. Returns how many alerts went out. */
    public int runWarnings() {
        List<Long> wanting = recipients(AlertType.WEATHER_NWS);
        if (wanting.isEmpty()) return 0;
        List<Warning> active;
        try {
            active = warnings();
        } catch (RuntimeException e) {
            log.warn("Weather warnings check failed: {}", e.getMessage());
            return 0;
        }
        int sent = 0;
        for (Long userId : wanting) {
            int level = resolve(userId, WeatherAlertRule.WARNINGS).threshold();
            for (Warning w : active) {
                if (!w.actionable() || w.level() > level) continue;
                String key = key(w.id());
                if (checks.existsByUserIdAndAlertTypeAndAlertKey(userId, AlertType.WEATHER_NWS, key)) continue;
                // An update to a warning they already have (new id, naming the old one) isn't sent again.
                boolean update = !w.references().isEmpty() && checks.existsByUserIdAndAlertTypeAndAlertKeyIn(
                        userId, AlertType.WEATHER_NWS, w.references().stream().map(WeatherAlertService::key).toList());
                boolean alerted = false;
                if (!update) {
                    Alert a = warningAlert(w);
                    alerted = notifications.send(userId, AlertType.WEATHER_NWS, a.severity(), a.title(), a.message()) != null;
                }
                record(userId, AlertType.WEATHER_NWS, key, alerted);
                if (alerted) {
                    sent++;
                    log.info("Weather warning for user {}: {}", userId, w.event());
                }
            }
        }
        return sent;
    }

    static Alert warningAlert(Warning w) {
        boolean dangerous = "Extreme".equalsIgnoreCase(w.severity()) || "Severe".equalsIgnoreCase(w.severity());
        Severity severity = w.level() == 1 ? (dangerous ? Severity.CRITICAL : Severity.WARNING)
                : w.level() == 2 ? Severity.WARNING : Severity.INFO;
        String text = (nullToEmpty(w.headline()) + " " + nullToEmpty(w.instruction())).replaceAll("\\s+", " ").trim();
        if (text.length() > MESSAGE_MAX) text = text.substring(0, MESSAGE_MAX - 1).trim() + "…";
        String title = w.event() == null ? "Weather warning" : w.event();
        return new Alert(severity, title.length() > 200 ? title.substring(0, 200) : title, text);
    }

    private List<Long> recipients(AlertType type) {
        List<Long> members = users.findByStatus(User.AccountStatus.ACTIVE).stream()
                .filter(u -> u.getRole() != User.Role.GUEST)
                .map(User::getId)
                .toList();
        return notifications.wanting(members, type);
    }

    private void record(Long userId, AlertType type, String key, boolean sent) {
        try {
            checks.save(WeatherAlertLog.builder().userId(userId).alertType(type).alertKey(key).sent(sent).build());
        } catch (DataIntegrityViolationException e) {
            log.debug("Weather check {} {} for user {} was already logged", type, key, userId);
        }
    }

    private static String key(String id) {
        return id.length() > 255 ? id.substring(0, 255) : id;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    // ── Sources ──

    /** The next three days of hourly forecast for home, reused for {@link #FORECAST_TTL}. */
    List<Hour> forecast() {
        Cached<List<Hour>> c = forecastCache;
        Instant now = Instant.now();
        if (c != null && c.at().plus(FORECAST_TTL).isAfter(now)) return c.value();
        requireLocation();
        String json = http.getForObject(String.format(Locale.US, FORECAST_URL, latitude, longitude), String.class);
        List<Hour> hours = parseForecast(read(json));
        if (hours.isEmpty()) throw new IllegalStateException("Open-Meteo returned no forecast hours");
        forecastCache = new Cached<>(now, hours);
        return hours;
    }

    /** Alerts in effect for home from weather.gov, reused for {@link #WARNINGS_TTL}. */
    List<Warning> warnings() {
        Cached<List<Warning>> c = warningsCache;
        Instant now = Instant.now();
        if (c != null && c.at().plus(WARNINGS_TTL).isAfter(now)) return c.value();
        requireLocation();
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
        headers.setAccept(List.of(MediaType.parseMediaType("application/geo+json")));
        String json = http.exchange(String.format(Locale.US, WARNINGS_URL, latitude, longitude),
                HttpMethod.GET, new HttpEntity<>(headers), String.class).getBody();
        List<Warning> active = parseWarnings(read(json));
        warningsCache = new Cached<>(now, active);
        return active;
    }

    private void requireLocation() {
        if (latitude == 0 && longitude == 0) {
            throw new IllegalStateException("home location isn't set (PROPERTY_LATITUDE / PROPERTY_LONGITUDE)");
        }
    }

    private static JsonNode read(String json) {
        if (json == null) throw new IllegalStateException("empty response");
        try {
            return mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("unreadable response: " + e.getOriginalMessage());
        }
    }

    /** Open-Meteo hourly arrays → hours. Missing amounts count as none; a missing temperature is NaN. */
    static List<Hour> parseForecast(JsonNode raw) {
        JsonNode hourly = raw == null ? null : raw.get("hourly");
        JsonNode time = hourly == null ? null : hourly.get("time");
        if (time == null || !time.isArray()) return List.of();
        List<Hour> hours = new ArrayList<>(time.size());
        for (int i = 0; i < time.size(); i++) {
            hours.add(new Hour(LocalDateTime.parse(time.get(i).asText()),
                    value(hourly, "temperature_2m", i),
                    value(hourly, "apparent_temperature", i),
                    orZero(value(hourly, "precipitation", i)),
                    (int) Math.round(orZero(value(hourly, "precipitation_probability", i))),
                    orZero(value(hourly, "wind_gusts_10m", i)),
                    orZero(value(hourly, "snowfall", i)),
                    (int) orZero(value(hourly, "weather_code", i))));
        }
        return hours;
    }

    private static double value(JsonNode hourly, String field, int i) {
        JsonNode values = hourly.get(field);
        JsonNode v = values == null ? null : values.get(i);
        return v == null || v.isNull() ? Double.NaN : v.asDouble();
    }

    private static double orZero(double v) {
        return Double.isNaN(v) ? 0 : v;
    }

    /** weather.gov GeoJSON → warnings. A body without a features list is an error, not "no warnings". */
    static List<Warning> parseWarnings(JsonNode raw) {
        JsonNode features = raw == null ? null : raw.get("features");
        if (features == null || !features.isArray()) throw new IllegalStateException("weather.gov response has no features");
        List<Warning> active = new ArrayList<>();
        for (JsonNode f : features) {
            JsonNode p = f.get("properties");
            String id = text(p, "id");
            if (id == null) continue;
            List<String> refs = new ArrayList<>();
            JsonNode references = p.get("references");
            if (references != null && references.isArray()) {
                for (JsonNode r : references) {
                    String ref = text(r, "identifier");
                    if (ref != null) refs.add(ref);
                }
            }
            active.add(new Warning(id, refs, text(p, "event"), text(p, "headline"), text(p, "instruction"),
                    text(p, "severity"), text(p, "messageType"), text(p, "status")));
        }
        return active;
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node == null ? null : node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
