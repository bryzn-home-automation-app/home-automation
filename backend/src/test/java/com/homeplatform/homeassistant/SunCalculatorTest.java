package com.homeplatform.homeassistant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SunCalculatorTest {

    // Dallas, TX
    private static final double LAT = 32.78;
    private static final double LON = -96.80;

    private static void near(String expected, Instant actual) {
        long diff = Math.abs(Duration.between(Instant.parse(expected), actual).toMinutes());
        assertTrue(diff <= 5, "expected ~" + expected + " but was " + actual);
    }

    @Test
    @DisplayName("summer solstice: sunrise ~6:20 CDT, sunset ~8:38 CDT (next UTC day)")
    void summer() {
        var w = SunCalculator.sunUp(LocalDate.of(2026, 6, 21), LAT, LON).orElseThrow();
        near("2026-06-21T11:20:00Z", w.from());
        near("2026-06-22T01:38:00Z", w.to());
    }

    @Test
    @DisplayName("winter solstice: sunrise ~7:25 CST, sunset ~5:25 CST")
    void winter() {
        var w = SunCalculator.sunUp(LocalDate.of(2026, 12, 21), LAT, LON).orElseThrow();
        near("2026-12-21T13:25:00Z", w.from());
        near("2026-12-21T23:25:00Z", w.to());
    }

    @Test
    @DisplayName("daylight windows are clipped to the range; none when location is unset")
    void windows() {
        // 1 PM CDT on the 20th → 1 PM CDT on the 22nd: rest of the 20th, all of the 21st, morning of the 22nd.
        Instant from = Instant.parse("2026-10-20T18:00:00Z");
        Instant to = Instant.parse("2026-10-22T18:00:00Z");
        List<SunCalculator.Window> ws = SunCalculator.daylight(from, to, LAT, LON);
        assertEquals(3, ws.size());
        assertEquals(from, ws.get(0).from());
        assertEquals(to, ws.get(2).to());
        near("2026-10-21T12:31:00Z", ws.get(1).from());
        near("2026-10-21T23:48:00Z", ws.get(1).to());
        assertTrue(SunCalculator.daylight(from, to, 0, 0).isEmpty());
    }

    @Test
    @DisplayName("polar night has no window")
    void polar() {
        assertTrue(SunCalculator.sunUp(LocalDate.of(2026, 12, 21), 80, 15).isEmpty());
    }
}
