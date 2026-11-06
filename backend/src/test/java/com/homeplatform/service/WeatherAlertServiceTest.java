package com.homeplatform.service;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.model.WeatherAlertLog;
import com.homeplatform.model.WeatherAlertSetting;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.repository.WeatherAlertLogRepository;
import com.homeplatform.repository.WeatherAlertSettingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** When weather checks run, who they reach, and that each goes out once. */
class WeatherAlertServiceTest {

    private final List<WeatherAlertLog> log = new ArrayList<>();
    private final List<WeatherAlertSetting> saved = new ArrayList<>();
    private final Map<AlertType, Set<Long>> wanting = new EnumMap<>(AlertType.class);
    private NotificationService notifications;
    private NotificationPreferenceService preferences;
    private RestTemplate http;
    private WeatherAlertService service;

    @BeforeEach
    void setUp() {
        WeatherAlertLogRepository checks = mock(WeatherAlertLogRepository.class);
        when(checks.existsByUserIdAndAlertTypeAndAlertKey(any(), any(), any())).thenAnswer(i -> log.stream().anyMatch(l ->
                l.getUserId().equals(i.getArgument(0)) && l.getAlertType() == i.getArgument(1) && l.getAlertKey().equals(i.getArgument(2))));
        when(checks.existsByUserIdAndAlertTypeAndAlertKeyIn(any(), any(), any())).thenAnswer(i -> log.stream().anyMatch(l ->
                l.getUserId().equals(i.getArgument(0)) && l.getAlertType() == i.getArgument(1)
                        && ((Collection<?>) i.getArgument(2)).contains(l.getAlertKey())));
        when(checks.save(any())).thenAnswer(i -> {
            log.add(i.getArgument(0));
            return i.getArgument(0);
        });

        WeatherAlertSettingRepository settings = mock(WeatherAlertSettingRepository.class);
        when(settings.findByUserIdAndAlertType(any(), any())).thenAnswer(i -> saved.stream()
                .filter(s -> s.getUserId().equals(i.getArgument(0)) && s.getAlertType() == i.getArgument(1)).findFirst());
        when(settings.findByUserId(any())).thenAnswer(i -> saved.stream().filter(s -> s.getUserId().equals(i.getArgument(0))).toList());
        when(settings.save(any())).thenAnswer(i -> {
            WeatherAlertSetting s = i.getArgument(0);
            if (!saved.contains(s)) saved.add(s);
            return s;
        });

        UserRepository users = mock(UserRepository.class);
        when(users.findByStatus(User.AccountStatus.ACTIVE)).thenReturn(List.of(
                User.builder().id(1L).role(User.Role.ADMIN).build(),
                User.builder().id(2L).role(User.Role.USER).build(),
                User.builder().id(3L).role(User.Role.GUEST).build()));

        notifications = mock(NotificationService.class);
        when(notifications.wanting(anyList(), any())).thenAnswer(i -> ((List<Long>) i.getArgument(0)).stream()
                .filter(u -> wanting.getOrDefault((AlertType) i.getArgument(1), Set.of()).contains(u)).toList());
        when(notifications.send(any(), any(), any(), any(), any())).thenReturn(new Notification());

        preferences = mock(NotificationPreferenceService.class);
        when(preferences.effective(any(), any())).thenReturn(new NotificationPreferenceService.Effective(true, true));

        http = mock(RestTemplate.class);
        service = new WeatherAlertService(settings, checks, notifications, preferences, users, http, 33.2, -97.1);
    }

    /** Open-Meteo hourly JSON from 6 PM Nov 5 for 48 hours: dry, except 80% rain from 2 to 6 AM. */
    private static String forecast() {
        StringJoiner time = new StringJoiner(",");
        StringJoiner temp = new StringJoiner(",");
        StringJoiner precip = new StringJoiner(",");
        StringJoiner chance = new StringJoiner(",");
        StringJoiner code = new StringJoiner(",");
        LocalDateTime t = LocalDateTime.of(2026, 11, 5, 18, 0);
        for (int i = 0; i < 48; i++, t = t.plusHours(1)) {
            boolean rain = t.getDayOfMonth() == 6 && t.getHour() >= 2 && t.getHour() < 6;
            time.add("\"" + t + "\"");
            temp.add(i == 3 ? "null" : "55");
            precip.add(rain ? "0.1" : "0");
            chance.add(rain ? "80" : "0");
            code.add(rain ? "63" : "1");
        }
        return "{\"hourly\":{\"time\":[" + time + "],\"temperature_2m\":[" + temp + "],\"apparent_temperature\":[" + temp
                + "],\"precipitation\":[" + precip + "],\"precipitation_probability\":[" + chance
                + "],\"weather_code\":[" + code + "],\"wind_gusts_10m\":[" + temp + "],\"snowfall\":[" + temp.toString().replaceAll("[0-9]+", "0") + "]}}";
    }

    private void forecastReturns(String json) {
        when(http.getForObject(contains("open-meteo"), eq(String.class))).thenReturn(json);
    }

    private static LocalDateTime nov5(int hour, int minute) {
        return LocalDateTime.of(2026, 11, 5, hour, minute);
    }

    @Test
    @DisplayName("rain overnight: at 8 PM, only members who turned it on get it, once")
    void rainOnce() {
        wanting.put(AlertType.WEATHER_RAIN, Set.of(2L, 3L));
        forecastReturns(forecast());

        assertEquals(1, service.runScheduled(nov5(20, 0)));
        verify(notifications).send(eq(2L), eq(AlertType.WEATHER_RAIN), eq(Severity.INFO), eq("Rain likely overnight"),
                eq("Up to 80% chance from about 2 AM to 6 AM, about 0.40 inches in all. Enough to skip watering."));
        assertEquals("2026-11-05T20:00", log.get(0).getAlertKey());
        assertTrue(log.get(0).isSent());

        assertEquals(0, service.runScheduled(nov5(20, 5)), "the 8 PM check ran already");
        verify(notifications, times(1)).send(any(), any(), any(), any(), any());
        verify(notifications, never()).send(eq(3L), any(), any(), any(), any());
    }

    @Test
    @DisplayName("nothing runs before the check time or after the grace period; a check missed while down still runs")
    void timing() {
        wanting.put(AlertType.WEATHER_RAIN, Set.of(1L));
        forecastReturns(forecast());

        assertEquals(0, service.runScheduled(nov5(19, 55)));
        assertEquals(0, service.runScheduled(nov5(22, 5)));
        assertTrue(log.isEmpty());
        verifyNoInteractions(http);

        assertEquals(1, service.runScheduled(nov5(21, 30)), "back up 90 minutes after 8 PM");
    }

    @Test
    @DisplayName("a forecast that can't be reached is retried at the next tick, not logged as checked")
    void fetchFailure() {
        wanting.put(AlertType.WEATHER_RAIN, Set.of(1L));
        when(http.getForObject(contains("open-meteo"), eq(String.class)))
                .thenThrow(new ResourceAccessException("timed out"))
                .thenReturn(forecast());

        assertEquals(0, service.runScheduled(nov5(20, 0)));
        assertTrue(log.isEmpty());
        assertEquals(1, service.runScheduled(nov5(20, 5)));
    }

    @Test
    @DisplayName("a quiet check is logged as made, with no alert; a member's own time and limit are used")
    void ownSettings() {
        wanting.put(AlertType.WEATHER_RAIN, Set.of(1L));
        forecastReturns(forecast());
        saved.add(WeatherAlertSetting.builder().userId(1L).alertType(AlertType.WEATHER_RAIN)
                .checkAt(LocalTime.of(21, 0)).until(LocalTime.of(23, 0)).threshold(50).build());

        assertEquals(0, service.runScheduled(nov5(20, 0)), "their check is at 9 PM");
        assertEquals(0, service.runScheduled(nov5(21, 0)), "no rain from 9 to 11 PM");
        assertEquals(1, log.size());
        assertFalse(log.get(0).isSent());
        verify(notifications, never()).send(any(), any(), any(), any(), any());
    }

    private static final String WARNINGS = """
            {"features":[
              {"properties":{"id":"urn:A","event":"Tornado Warning","severity":"Extreme","messageType":"Alert","status":"Actual",
                "headline":"Tornado Warning issued November 5 at 8:40PM CST until 9:15PM CST by NWS Fort Worth TX",
                "instruction":"TAKE COVER NOW!\\n Move to a basement or an interior room.","references":[]}},
              {"properties":{"id":"urn:B","event":"Flood Watch","severity":"Moderate","messageType":"Alert","status":"Actual",
                "headline":"Flood Watch","references":[]}},
              {"properties":{"id":"urn:C","event":"Wind Advisory","severity":"Minor","messageType":"Alert","status":"Actual",
                "headline":"Wind Advisory","references":[]}},
              {"properties":{"id":"urn:D","event":"Tornado Warning","severity":"Extreme","messageType":"Update","status":"Actual",
                "headline":"Tornado Warning continues","references":[{"identifier":"urn:A"}]}},
              {"properties":{"id":"urn:E","event":"Severe Thunderstorm Warning","severity":"Severe","messageType":"Cancel","status":"Actual",
                "headline":"cancelled","references":[]}},
              {"properties":{"id":"urn:F","event":"Tornado Warning","severity":"Extreme","messageType":"Alert","status":"Test",
                "headline":"test","references":[]}}
            ]}""";

    private void warningsReturn(String json) {
        when(http.exchange(contains("weather.gov"), eq(HttpMethod.GET), any(), eq(String.class)))
                .thenReturn(ResponseEntity.ok(json));
    }

    @Test
    @DisplayName("NWS warnings: only the levels each member chose, once, and not again when the warning is updated")
    void warnings() {
        wanting.put(AlertType.WEATHER_NWS, Set.of(1L, 2L));
        saved.add(WeatherAlertSetting.builder().userId(2L).alertType(AlertType.WEATHER_NWS).threshold(3).build());
        warningsReturn(WARNINGS);

        assertEquals(4, service.runWarnings(), "member 1: the tornado warning; member 2: it, the watch and the advisory");
        verify(notifications).send(eq(1L), eq(AlertType.WEATHER_NWS), eq(Severity.CRITICAL), eq("Tornado Warning"),
                eq("Tornado Warning issued November 5 at 8:40PM CST until 9:15PM CST by NWS Fort Worth TX "
                        + "TAKE COVER NOW! Move to a basement or an interior room."));
        verify(notifications).send(eq(2L), any(), eq(Severity.WARNING), eq("Flood Watch"), any());
        verify(notifications).send(eq(2L), any(), eq(Severity.INFO), eq("Wind Advisory"), any());
        verify(notifications, never()).send(any(), any(), any(), eq("Severe Thunderstorm Warning"), any());
        assertTrue(log.stream().anyMatch(l -> l.getAlertKey().equals("urn:D") && !l.isSent()), "the update is noted, not sent");

        assertEquals(0, service.runWarnings());
    }

    @Test
    @DisplayName("no warnings call when nobody wants them; an unreadable answer sends and logs nothing")
    void warningsQuiet() {
        assertEquals(0, service.runWarnings());
        verifyNoInteractions(http);

        wanting.put(AlertType.WEATHER_NWS, Set.of(1L));
        warningsReturn("{\"title\":\"error\"}");
        assertEquals(0, service.runWarnings());
        assertTrue(log.isEmpty());
    }

    @Test
    @DisplayName("preview shows the next check and what it would say right now")
    void preview() {
        forecastReturns(forecast());
        var p = service.preview(1L, WeatherAlertRule.RAIN, nov5(19, 30));
        assertEquals("Tonight at 8 PM", p.when());
        assertEquals("8 PM – 8 AM", p.hours());
        assertEquals("Rain likely overnight", p.title());
        assertEquals("INFO", p.severity());

        var later = service.preview(1L, WeatherAlertRule.RAIN, nov5(20, 30));
        assertEquals("Tomorrow at 8 PM", later.when());
        assertNull(later.title());
        assertEquals("No rain in the forecast.", later.summary());

        warningsReturn("{\"features\":[]}");
        var w = service.preview(1L, WeatherAlertRule.WARNINGS, nov5(20, 0));
        assertNull(w.title());
        assertEquals("None in effect for home right now.", w.summary());
    }

    @Test
    @DisplayName("settings: on/off goes to the alert preferences, times and limit are saved per member")
    void update() {
        var r = service.update(1L, WeatherAlertRule.RAIN,
                new WeatherAlertService.Change(true, true, LocalTime.of(21, 30), LocalTime.of(6, 0), 70));
        verify(preferences).update(1L, AlertType.WEATHER_RAIN, true, true);
        assertEquals("21:30", r.checkAt());
        assertEquals("06:00", r.until());
        assertEquals(70, r.threshold());

        var list = service.list(2L);
        var rain = list.stream().filter(x -> x.type().equals("WEATHER_RAIN")).findFirst().orElseThrow();
        assertEquals("20:00", rain.checkAt(), "someone else still has the defaults");
        assertEquals(50, rain.threshold());
        var nws = list.stream().filter(x -> x.type().equals("WEATHER_NWS")).findFirst().orElseThrow();
        assertFalse(nws.scheduled());
        assertNull(nws.checkAt());
        assertNull(list.stream().filter(x -> x.type().equals("WEATHER_STORMS")).findFirst().orElseThrow().threshold());
    }

    @Test
    @DisplayName("a check is due from its time until the grace period ends, including one late last night")
    void due() {
        assertEquals(nov5(20, 0), WeatherAlertService.due(nov5(20, 0), LocalTime.of(20, 0)));
        assertNull(WeatherAlertService.due(nov5(19, 59), LocalTime.of(20, 0)));
        assertEquals(nov5(23, 30), WeatherAlertService.due(LocalDateTime.of(2026, 11, 6, 0, 30), LocalTime.of(23, 30)));
    }
}
