package com.homeplatform.service;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Severity;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.function.ToDoubleFunction;
import java.util.stream.IntStream;

/**
 * The weather alerts members can turn on, and what each one looks for. The forecast ones
 * are checked once a day at the member's time, over the hours from then until their end
 * time (Rain: at 8 PM, through 8 AM, so there's time to pause the sprinklers).
 * {@link #WARNINGS} passes on National Weather Service warnings as they're issued.
 */
public enum WeatherAlertRule {

    RAIN(AlertType.WEATHER_RAIN, LocalTime.of(20, 0), LocalTime.of(8, 0), 50, "Chance of rain",
            range(20, 90, 10, "%d%%")) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = within(hours, from, to);
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            Hour peak = max(in, Hour::chance);
            List<Hour> hits = in.stream().filter(h -> h.chance() >= threshold).toList();
            if (hits.isEmpty()) {
                return Verdict.quiet(peak.chance() == 0 ? "No rain in the forecast"
                        : "Highest chance of rain " + peak.chance() + "%, around " + clock(peak.time(), from, to));
            }
            double total = in.stream().mapToDouble(Hour::precipitation).sum();
            String amount = total >= 0.05 ? String.format(Locale.US, ", about %.2f inches in all", total) : ", only a trace";
            return Verdict.alert(Severity.INFO,
                    "Rain " + (peak.chance() >= 60 ? "likely " : "possible ") + phrase(from, to),
                    "Up to " + peak.chance() + "% chance " + span(hits, from, to) + amount + "."
                            + (total >= 0.1 ? " Enough to skip watering." : ""));
        }
    },

    WARNINGS(AlertType.WEATHER_NWS, null, null, 1, "Send",
            List.of(new Option(1, "Warnings"), new Option(2, "Warnings and watches"),
                    new Option(3, "Warnings, watches and advisories"))),

    STORMS(AlertType.WEATHER_STORMS, LocalTime.of(7, 0), LocalTime.of(7, 0), null, null, List.of()) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = within(hours, from, to);
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            List<Hour> hits = in.stream().filter(h -> THUNDER.contains(h.code())).toList();
            if (hits.isEmpty()) return Verdict.quiet("No thunderstorms in the forecast");
            boolean hail = hits.stream().anyMatch(h -> h.code() != 95);
            int chance = max(hits, Hour::chance).chance();
            return Verdict.alert(Severity.WARNING,
                    "Thunderstorms " + (chance >= 60 ? "likely " : "possible ") + phrase(from, to),
                    "Storms " + span(hits, from, to) + (hail ? ", possibly with hail" : "")
                            + (chance > 0 ? ". Up to " + chance + "% chance of rain." : "."));
        }
    },

    FREEZE(AlertType.WEATHER_FREEZE, LocalTime.of(18, 0), LocalTime.of(10, 0), 32, "At or below",
            range(20, 40, 2, "%d°F")) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = withTemperature(within(hours, from, to));
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            Hour coldest = min(in, Hour::temperature);
            int low = (int) Math.round(coldest.temperature());
            List<Hour> hits = in.stream().filter(h -> h.temperature() <= threshold).toList();
            if (hits.isEmpty()) return Verdict.quiet("Low of " + low + "°F, around " + clock(coldest.time(), from, to));
            return Verdict.alert(Severity.WARNING,
                    (low <= 32 ? "Freeze " : "Near freezing ") + phrase(from, to) + " — low of " + low + "°F",
                    "At or below " + threshold + "°F " + span(hits, from, to) + ", coldest around "
                            + clock(coldest.time(), from, to) + ". Protect pipes, plants and outdoor faucets.");
        }
    },

    HEAT(AlertType.WEATHER_HEAT, LocalTime.of(7, 0), LocalTime.of(21, 0), 100, "At or above",
            range(90, 112, 2, "%d°F")) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = withTemperature(within(hours, from, to));
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            Hour hottest = max(in, Hour::temperature);
            int high = (int) Math.round(hottest.temperature());
            List<Hour> hits = in.stream().filter(h -> h.temperature() >= threshold).toList();
            if (hits.isEmpty()) return Verdict.quiet("High of " + high + "°F, around " + clock(hottest.time(), from, to));
            int feels = (int) Math.round(in.stream().mapToDouble(Hour::feelsLike)
                    .filter(f -> !Double.isNaN(f)).max().orElse(high));
            return Verdict.alert(Severity.WARNING,
                    "Extreme heat " + phrase(from, to) + " — high of " + high + "°F",
                    "At or above " + threshold + "°F " + span(hits, from, to)
                            + (feels >= high + 3 ? ", feeling like up to " + feels + "°F" : "")
                            + ". Limit time outside and keep pets in.");
        }
    },

    WIND(AlertType.WEATHER_WIND, LocalTime.of(7, 0), LocalTime.of(21, 0), 40, "Gusts of",
            range(25, 70, 5, "%d mph")) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = within(hours, from, to);
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            Hour strongest = max(in, Hour::gust);
            int gust = (int) Math.round(strongest.gust());
            List<Hour> hits = in.stream().filter(h -> h.gust() >= threshold).toList();
            if (hits.isEmpty()) return Verdict.quiet("Strongest gusts " + gust + " mph");
            return Verdict.alert(Severity.WARNING,
                    "High winds " + phrase(from, to) + " — gusts to " + gust + " mph",
                    "Gusts of " + threshold + " mph or more " + span(hits, from, to)
                            + ". Secure patio furniture, trash bins and anything loose outside.");
        }
    },

    WINTER(AlertType.WEATHER_WINTER, LocalTime.of(18, 0), LocalTime.of(18, 0), null, null, List.of()) {
        @Override
        Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
            List<Hour> in = within(hours, from, to);
            if (in.isEmpty()) return Verdict.quiet(NO_FORECAST);
            List<Hour> hits = in.stream()
                    .filter(h -> ICE.contains(h.code()) || SNOW.contains(h.code()) || h.snowfall() >= 0.1)
                    .toList();
            if (hits.isEmpty()) return Verdict.quiet("No snow or ice in the forecast");
            boolean ice = hits.stream().anyMatch(h -> ICE.contains(h.code()));
            boolean snow = hits.stream().anyMatch(h -> SNOW.contains(h.code()) || h.snowfall() > 0);
            double inches = in.stream().mapToDouble(Hour::snowfall).sum();
            String kind = ice && snow ? "Snow and ice" : ice ? "Freezing rain" : "Snow";
            return Verdict.alert(Severity.WARNING,
                    kind + " " + phrase(from, to),
                    kind + " " + span(hits, from, to)
                            + (inches >= 0.1 ? String.format(Locale.US, ", around %.1f inches of snow", inches) : "")
                            + ". Roads and walkways may be slick; protect pipes and plants.");
        }
    };

    static final String NO_FORECAST = "No forecast for these hours yet";
    /** WMO weather codes (what Open-Meteo reports). */
    static final Set<Integer> THUNDER = Set.of(95, 96, 99);
    static final Set<Integer> ICE = Set.of(56, 57, 66, 67);
    static final Set<Integer> SNOW = Set.of(71, 73, 75, 77, 85, 86);

    /** A choice for the limit, as the settings show it. */
    public record Option(int value, String label) {}

    /** One forecast hour (local time) with what the rules look at. Missing temperatures are NaN. */
    public record Hour(LocalDateTime time, double temperature, double feelsLike, double precipitation,
                       int chance, double gust, double snowfall, int code) {}

    public record Alert(Severity severity, String title, String message) {}

    /** What a check found: an alert to send, or a one-line summary of why not. */
    public record Verdict(Alert alert, String summary) {
        static Verdict quiet(String summary) {
            return new Verdict(null, summary);
        }

        static Verdict alert(Severity severity, String title, String message) {
            return new Verdict(new Alert(severity, title, message), title);
        }
    }

    private final AlertType type;
    private final LocalTime defaultCheckAt;
    private final LocalTime defaultUntil;
    private final Integer defaultThreshold;
    private final String thresholdLabel;
    private final List<Option> options;

    WeatherAlertRule(AlertType type, LocalTime defaultCheckAt, LocalTime defaultUntil, Integer defaultThreshold,
                     String thresholdLabel, List<Option> options) {
        this.type = type;
        this.defaultCheckAt = defaultCheckAt;
        this.defaultUntil = defaultUntil;
        this.defaultThreshold = defaultThreshold;
        this.thresholdLabel = thresholdLabel;
        this.options = options;
    }

    public AlertType type() { return type; }
    public LocalTime defaultCheckAt() { return defaultCheckAt; }
    public LocalTime defaultUntil() { return defaultUntil; }
    public Integer defaultThreshold() { return defaultThreshold; }
    public String thresholdLabel() { return thresholdLabel; }
    public List<Option> options() { return options; }

    /** Checked once a day at a time of the member's choosing (all but {@link #WARNINGS}). */
    public boolean scheduled() {
        return defaultCheckAt != null;
    }

    public boolean allows(int threshold) {
        return options.stream().anyMatch(o -> o.value() == threshold);
    }

    /** Look at the forecast hours from {@code from} to {@code to}. */
    Verdict check(List<Hour> hours, LocalDateTime from, LocalDateTime to, int threshold) {
        throw new UnsupportedOperationException(this + " isn't a forecast check");
    }

    /** By alert type ("WEATHER_RAIN") or rule name ("rain"). */
    public static Optional<WeatherAlertRule> of(String name) {
        if (name == null) return Optional.empty();
        return Arrays.stream(values())
                .filter(r -> r.name().equalsIgnoreCase(name) || r.type.name().equalsIgnoreCase(name))
                .findFirst();
    }

    /** A check at {@code checkAt} covers until the next {@code until}: later that day, else the next (24 hours when equal). */
    public static LocalDateTime windowEnd(LocalDateTime checkAt, LocalTime until) {
        LocalDateTime end = checkAt.toLocalDate().atTime(until);
        return end.isAfter(checkAt) ? end : end.plusDays(1);
    }

    /** Hours that overlap [from, to). */
    static List<Hour> within(List<Hour> hours, LocalDateTime from, LocalDateTime to) {
        return hours.stream().filter(h -> h.time().plusHours(1).isAfter(from) && h.time().isBefore(to)).toList();
    }

    private static List<Hour> withTemperature(List<Hour> hours) {
        return hours.stream().filter(h -> !Double.isNaN(h.temperature())).toList();
    }

    private static Hour max(List<Hour> hours, ToDoubleFunction<Hour> by) {
        return hours.stream().max(Comparator.comparingDouble(by)).orElseThrow();
    }

    private static Hour min(List<Hour> hours, ToDoubleFunction<Hour> by) {
        return hours.stream().min(Comparator.comparingDouble(by)).orElseThrow();
    }

    /** "tonight", "overnight", "today", "later today", or "in the next N hours" for a check's hours. */
    static String phrase(LocalDateTime from, LocalDateTime to) {
        LocalDate lastDay = to.minusMinutes(1).toLocalDate();
        boolean sameDay = lastDay.equals(from.toLocalDate());
        if (sameDay) return from.getHour() >= 17 ? "tonight" : from.getHour() < 12 ? "today" : "later today";
        boolean nextMorning = lastDay.equals(from.toLocalDate().plusDays(1)) && !to.toLocalTime().isAfter(LocalTime.NOON);
        if (from.getHour() >= 17 && nextMorning) return "overnight";
        return "in the next " + Math.round(Duration.between(from, to).toMinutes() / 60.0) + " hours";
    }

    /** "3 AM", "8:30 PM", "noon", "midnight". */
    public static String clockTime(LocalTime t) {
        if (t.getMinute() == 0 && t.getHour() == 0) return "midnight";
        if (t.getMinute() == 0 && t.getHour() == 12) return "noon";
        int h = t.getHour() % 12 == 0 ? 12 : t.getHour() % 12;
        return h + (t.getMinute() == 0 ? "" : String.format(Locale.US, ":%02d", t.getMinute()))
                + (t.getHour() < 12 ? " AM" : " PM");
    }

    /** A time in a check's hours: "3 AM", or "3 AM tomorrow" on a later day (not needed overnight, or for midnight). */
    static String clock(LocalDateTime t, LocalDateTime from, LocalDateTime to) {
        return clockTime(t.toLocalTime()) + (tomorrow(t, from, to) ? " tomorrow" : "");
    }

    private static boolean tomorrow(LocalDateTime t, LocalDateTime from, LocalDateTime to) {
        return t.toLocalDate().isAfter(from.toLocalDate()) && !t.toLocalTime().equals(LocalTime.MIDNIGHT)
                && !"overnight".equals(phrase(from, to));
    }

    /** "around 3 AM" for one hour, else "from about 2 AM to 6 AM" (first hour to the end of the last). */
    static String span(List<Hour> hits, LocalDateTime from, LocalDateTime to) {
        LocalDateTime first = hits.get(0).time();
        LocalDateTime end = hits.get(hits.size() - 1).time().plusHours(1);
        if (first.plusHours(1).equals(end)) return "around " + clock(first, from, to);
        String hours = "from about " + clockTime(first.toLocalTime()) + " to " + clockTime(end.toLocalTime());
        return hours + (tomorrow(end, from, to) || tomorrow(first, from, to) ? " tomorrow" : "");
    }

    private static List<Option> range(int from, int to, int step, String format) {
        return IntStream.iterate(from, v -> v <= to, v -> v + step)
                .mapToObj(v -> new Option(v, String.format(Locale.US, format, v)))
                .toList();
    }
}
