package com.homeplatform.service;

import com.homeplatform.model.Notification.Severity;
import com.homeplatform.service.WeatherAlertRule.Hour;
import com.homeplatform.service.WeatherAlertRule.Verdict;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.function.UnaryOperator;

import static org.junit.jupiter.api.Assertions.*;

/** What each weather alert looks for, over which hours, and how it reads. */
class WeatherAlertRuleTest {

    private static final LocalDateTime EVENING = LocalDateTime.of(2026, 11, 5, 20, 0);

    /** 48 calm hours from 6 PM: 60°F, dry, light wind. */
    private static List<Hour> calm() {
        List<Hour> hours = new ArrayList<>();
        LocalDateTime t = LocalDateTime.of(2026, 11, 5, 18, 0);
        for (int i = 0; i < 48; i++) hours.add(new Hour(t.plusHours(i), 60, 60, 0, 0, 10, 0, 1));
        return hours;
    }

    /** {@code hours} with the ones from {@code from} (inclusive) to {@code to} (exclusive) changed. */
    private static List<Hour> with(List<Hour> hours, LocalDateTime from, LocalDateTime to, UnaryOperator<Hour> change) {
        return hours.stream().map(h -> !h.time().isBefore(from) && h.time().isBefore(to) ? change.apply(h) : h).toList();
    }

    private static LocalDateTime nov6(int hour) {
        return LocalDateTime.of(2026, 11, 6, hour, 0);
    }

    private static Verdict check(WeatherAlertRule rule, List<Hour> hours, LocalTime until, int threshold) {
        return rule.check(hours, EVENING, WeatherAlertRule.windowEnd(EVENING, until), threshold);
    }

    @Test
    @DisplayName("a check covers until the next end time: later that day, else the next day, 24 hours when equal")
    void window() {
        assertEquals(nov6(8), WeatherAlertRule.windowEnd(EVENING, LocalTime.of(8, 0)));
        assertEquals(LocalDateTime.of(2026, 11, 5, 23, 0), WeatherAlertRule.windowEnd(EVENING, LocalTime.of(23, 0)));
        assertEquals(nov6(20), WeatherAlertRule.windowEnd(EVENING, LocalTime.of(20, 0)));
    }

    @Test
    @DisplayName("the hours are described the way people say them")
    void phrases() {
        LocalDateTime morning = LocalDateTime.of(2026, 11, 5, 7, 0);
        assertEquals("overnight", WeatherAlertRule.phrase(EVENING, nov6(8)));
        assertEquals("tonight", WeatherAlertRule.phrase(EVENING, nov6(0)));
        assertEquals("today", WeatherAlertRule.phrase(morning, LocalDateTime.of(2026, 11, 5, 21, 0)));
        assertEquals("in the next 24 hours", WeatherAlertRule.phrase(morning, nov6(7)));
        assertEquals("noon", WeatherAlertRule.clockTime(LocalTime.NOON));
        assertEquals("8:30 PM", WeatherAlertRule.clockTime(LocalTime.of(20, 30)));
        assertEquals("3 AM tomorrow", WeatherAlertRule.clock(nov6(3), morning, nov6(7)));
        assertEquals("3 AM", WeatherAlertRule.clock(nov6(3), EVENING, nov6(8)), "overnight needs no 'tomorrow'");
    }

    @Test
    @DisplayName("rain overnight at or over the chance limit: when, how likely, how much, and whether to skip watering")
    void rainOvernight() {
        List<Hour> hours = with(calm(), nov6(2), nov6(6), h -> new Hour(h.time(), 55, 55, 0.1, 80, 15, 0, 63));
        Verdict v = check(WeatherAlertRule.RAIN, hours, LocalTime.of(8, 0), 50);
        assertNotNull(v.alert());
        assertEquals(Severity.INFO, v.alert().severity());
        assertEquals("Rain likely overnight", v.alert().title());
        assertEquals("Up to 80% chance from about 2 AM to 6 AM, about 0.40 inches in all. Enough to skip watering.",
                v.alert().message());
    }

    @Test
    @DisplayName("rain below the limit, or after the hours checked, stays quiet with a summary")
    void rainQuiet() {
        List<Hour> unlikely = with(calm(), nov6(3), nov6(4), h -> new Hour(h.time(), 55, 55, 0, 30, 15, 0, 3));
        Verdict v = check(WeatherAlertRule.RAIN, unlikely, LocalTime.of(8, 0), 50);
        assertNull(v.alert());
        assertEquals("Highest chance of rain 30%, around 3 AM", v.summary());

        List<Hour> later = with(calm(), nov6(9), nov6(12), h -> new Hour(h.time(), 55, 55, 0.3, 90, 15, 0, 63));
        assertNull(check(WeatherAlertRule.RAIN, later, LocalTime.of(8, 0), 50).alert(), "rain after 8 AM isn't overnight");
        assertEquals("No rain in the forecast", check(WeatherAlertRule.RAIN, calm(), LocalTime.of(8, 0), 50).summary());
    }

    @Test
    @DisplayName("a likely shower with almost no rain says so instead of suggesting skipping the watering")
    void rainTrace() {
        List<Hour> hours = with(calm(), nov6(4), nov6(5), h -> new Hour(h.time(), 55, 55, 0.01, 55, 15, 0, 51));
        Verdict v = check(WeatherAlertRule.RAIN, hours, LocalTime.of(8, 0), 50);
        assertEquals("Rain possible overnight", v.alert().title());
        assertEquals("Up to 55% chance around 4 AM, only a trace.", v.alert().message());
    }

    @Test
    @DisplayName("freeze: below the limit overnight, with the low and when it's coldest")
    void freeze() {
        List<Hour> hours = with(calm(), nov6(1), nov6(9), h -> new Hour(h.time(), h.time().getHour() == 6 ? 28 : 31, 25, 0, 0, 5, 0, 0));
        Verdict v = check(WeatherAlertRule.FREEZE, hours, LocalTime.of(10, 0), 32);
        assertEquals(Severity.WARNING, v.alert().severity());
        assertEquals("Freeze overnight — low of 28°F", v.alert().title());
        assertEquals("At or below 32°F from about 1 AM to 9 AM, coldest around 6 AM. Protect pipes, plants and outdoor faucets.",
                v.alert().message());

        List<Hour> chilly = with(calm(), nov6(5), nov6(7), h -> new Hour(h.time(), 34, 34, 0, 0, 5, 0, 0));
        assertEquals("Near freezing overnight — low of 34°F", check(WeatherAlertRule.FREEZE, chilly, LocalTime.of(10, 0), 36).alert().title());
        assertNull(check(WeatherAlertRule.FREEZE, chilly, LocalTime.of(10, 0), 32).alert());
    }

    @Test
    @DisplayName("a missing temperature never counts as freezing")
    void missingTemperature() {
        List<Hour> hours = with(calm(), nov6(1), nov6(9), h -> new Hour(h.time(), Double.NaN, Double.NaN, 0, 0, 5, 0, 0));
        Verdict v = check(WeatherAlertRule.FREEZE, hours, LocalTime.of(10, 0), 32);
        assertNull(v.alert());
        assertEquals("Low of 60°F, around 8 PM", v.summary());
    }

    @Test
    @DisplayName("heat, wind, storms and snow or ice each name what they found")
    void others() {
        LocalDateTime morning = LocalDateTime.of(2026, 11, 6, 7, 0);
        LocalDateTime night = morning.withHour(21);
        List<Hour> hot = with(calm(), nov6(13), nov6(18), h -> new Hour(h.time(), h.time().getHour() == 16 ? 104 : 101, 110, 0, 0, 10, 0, 0));
        Verdict heat = WeatherAlertRule.HEAT.check(hot, morning, night, 100);
        assertEquals("Extreme heat today — high of 104°F", heat.alert().title());
        assertEquals("At or above 100°F from about 1 PM to 6 PM, feeling like up to 110°F. Limit time outside and keep pets in.",
                heat.alert().message());

        List<Hour> windy = with(calm(), nov6(14), nov6(16), h -> new Hour(h.time(), 60, 60, 0, 0, 48, 0, 3));
        Verdict wind = WeatherAlertRule.WIND.check(windy, morning, night, 40);
        assertEquals("High winds today — gusts to 48 mph", wind.alert().title());
        assertTrue(wind.alert().message().startsWith("Gusts of 40 mph or more from about 2 PM to 4 PM."));
        assertEquals("Strongest gusts 10 mph", WeatherAlertRule.WIND.check(calm(), morning, night, 40).summary());

        List<Hour> stormy = with(calm(), nov6(22), nov6(23), h -> new Hour(h.time(), 70, 70, 0.5, 70, 40, 0, 96));
        Verdict storms = WeatherAlertRule.STORMS.check(stormy, morning, morning.plusDays(1), 0);
        assertEquals("Thunderstorms likely in the next 24 hours", storms.alert().title());
        assertEquals("Storms around 10 PM, possibly with hail. Up to 70% chance of rain.", storms.alert().message());

        List<Hour> icy = with(calm(), nov6(3), nov6(8), h -> new Hour(h.time(), 30, 22, 0.05, 80, 15, 0, 66));
        Verdict ice = check(WeatherAlertRule.WINTER, icy, LocalTime.of(20, 0), 0);
        assertEquals("Freezing rain in the next 24 hours", ice.alert().title());
        assertTrue(ice.alert().message().startsWith("Freezing rain from about 3 AM to 8 AM tomorrow."), ice.alert().message());

        List<Hour> snowy = with(calm(), nov6(3), nov6(6), h -> new Hour(h.time(), 28, 20, 0.1, 80, 15, 0.5, 73));
        assertTrue(check(WeatherAlertRule.WINTER, snowy, LocalTime.of(20, 0), 0).alert().message()
                .contains(", around 1.5 inches of snow."));
    }

    @Test
    @DisplayName("each limit has its choices, and the defaults are among them")
    void options() {
        for (WeatherAlertRule r : WeatherAlertRule.values()) {
            if (r.defaultThreshold() != null) assertTrue(r.allows(r.defaultThreshold()), r.name());
        }
        assertTrue(WeatherAlertRule.FREEZE.allows(36));
        assertFalse(WeatherAlertRule.RAIN.allows(55));
        assertFalse(WeatherAlertRule.WARNINGS.scheduled());
        assertEquals(WeatherAlertRule.RAIN, WeatherAlertRule.of("weather_rain").orElseThrow());
        assertEquals(WeatherAlertRule.WARNINGS, WeatherAlertRule.of("WEATHER_NWS").orElseThrow());
    }
}
