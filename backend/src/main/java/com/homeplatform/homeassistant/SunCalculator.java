package com.homeplatform.homeassistant;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Sunrise/sunset for the property, so the camera battery chart can shade night and
 * solar gains line up with daylight. The standard almanac algorithm (US Naval
 * Observatory, "official" zenith 90.833°) — accurate to a couple of minutes, which is
 * plenty for shading a chart.
 */
public final class SunCalculator {

    private static final double ZENITH = 90.833;

    public record Window(Instant from, Instant to) {}

    private SunCalculator() {}

    /**
     * Daylight windows overlapping {@code [from, to]}, clipped to it. Empty when the
     * location is unset (0,0) — the chart then just skips the shading.
     */
    public static List<Window> daylight(Instant from, Instant to, double lat, double lon) {
        List<Window> out = new ArrayList<>();
        if ((lat == 0 && lon == 0) || !from.isBefore(to)) return out;
        LocalDate day = LocalDate.ofInstant(from, ZoneOffset.UTC).minusDays(1);
        LocalDate last = LocalDate.ofInstant(to, ZoneOffset.UTC).plusDays(1);
        for (; !day.isAfter(last); day = day.plusDays(1)) {
            Optional<Window> w = sunUp(day, lat, lon);
            if (w.isEmpty()) continue;
            Instant start = w.get().from().isBefore(from) ? from : w.get().from();
            Instant end = w.get().to().isAfter(to) ? to : w.get().to();
            if (start.isBefore(end)) out.add(new Window(start, end));
        }
        return out;
    }

    /**
     * Sunrise → sunset for the solar day {@code date} at the location (UTC instants;
     * sunset may fall on the next UTC date west of Greenwich). Empty during polar
     * day/night.
     */
    public static Optional<Window> sunUp(LocalDate date, double lat, double lon) {
        Optional<Double> rise = utcHours(date, lat, lon, true);
        Optional<Double> set = utcHours(date, lat, lon, false);
        if (rise.isEmpty() || set.isEmpty()) return Optional.empty();
        Instant midnight = date.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant sunrise = midnight.plus(Duration.ofSeconds(Math.round(rise.get() * 3600)));
        Instant sunset = midnight.plus(Duration.ofSeconds(Math.round(set.get() * 3600)));
        if (!sunset.isAfter(sunrise)) sunset = sunset.plus(Duration.ofDays(1));
        return Optional.of(new Window(sunrise, sunset));
    }

    private static Optional<Double> utcHours(LocalDate date, double lat, double lon, boolean rising) {
        int n = date.getDayOfYear();
        double lngHour = lon / 15;
        double t = n + ((rising ? 6 : 18) - lngHour) / 24;
        double m = 0.9856 * t - 3.289;
        double l = norm(m + 1.916 * sin(m) + 0.020 * sin(2 * m) + 282.634, 360);
        double ra = norm(Math.toDegrees(Math.atan(0.91764 * tan(l))), 360);
        ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90;
        ra /= 15;
        double sinDec = 0.39782 * sin(l);
        double cosDec = Math.cos(Math.asin(sinDec));
        double cosH = (cos(ZENITH) - sinDec * sin(lat)) / (cosDec * cos(lat));
        if (cosH > 1 || cosH < -1) return Optional.empty();
        double h = (rising ? 360 - Math.toDegrees(Math.acos(cosH)) : Math.toDegrees(Math.acos(cosH))) / 15;
        double localMean = h + ra - 0.06571 * t - 6.622;
        return Optional.of(norm(localMean - lngHour, 24));
    }

    private static double sin(double deg) { return Math.sin(Math.toRadians(deg)); }
    private static double cos(double deg) { return Math.cos(Math.toRadians(deg)); }
    private static double tan(double deg) { return Math.tan(Math.toRadians(deg)); }

    private static double norm(double v, double range) {
        double r = v % range;
        return r < 0 ? r + range : r;
    }
}
