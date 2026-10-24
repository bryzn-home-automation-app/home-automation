package com.homeplatform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.dto.WeatherResponse.*;
import com.homeplatform.model.WeatherObservation;
import com.homeplatform.repository.WeatherObservationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WeatherService {

    private static final Logger log = LoggerFactory.getLogger(WeatherService.class);
    private static final String FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
    private static final String ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
    private static final double HDD_BASE_TEMP = 65.0;
    private static final int PAST_DAYS = 92;
    static final String SOURCE_FORECAST = "open-meteo-forecast";
    static final String SOURCE_OBSERVED = "open-meteo-observed";
    static final String SOURCE_ARCHIVE = "open-meteo-archive";
    /** The forecast API's last day or two can still shift, so they're refreshed again. */
    static final int SETTLE_DAYS = 2;
    private static final ObjectMapper mapper = new ObjectMapper();
    /**
     * Open-Meteo responses are reused for this long. Home, Climate and Utility all hit
     * the same forecast URL (past_days covers their ranges), and each fetch took
     * 0.4-2 s — on every page load. Forecasts update hourly, so 10 min loses nothing.
     */
    static final Duration RESPONSE_TTL = Duration.ofMinutes(10);
    private record CachedResponse(Instant at, JsonNode body) {}
    private final Map<String, CachedResponse> responseCache = new ConcurrentHashMap<>();

    private final WeatherObservationRepository repo;
    private final RestTemplate restTemplate;
    private final AppEventService appEventService;

    public WeatherService(WeatherObservationRepository repo, RestTemplate restTemplate,
                          AppEventService appEventService) {
        this.repo = repo;
        this.restTemplate = restTemplate;
        this.appEventService = appEventService;
    }

    // ── Public API ──────────────────────────────────────────────

    public WeatherResponse getCurrentWeather(double lat, double lon) {
        LocalDate today = LocalDate.now();
        return getWeatherForDateRange(lat, lon, today.minusDays(1), today.plusDays(1));
    }

    public WeatherResponse getWeatherForDateRange(double lat, double lon, LocalDate start, LocalDate end) {
        String stationCode = formatStationCode(lat, lon);

        // 1. Try DB cache first — but never cache recent dates (last 2 days)
        //    because the DB only stores daily aggregates; hourly data must come
        //    from Open-Meteo for the correlation chart to render correctly.
        List<WeatherObservation> cached = repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                stationCode, start, end);

        boolean isRecent = !end.isBefore(LocalDate.now().minusDays(2));
        if (!isRecent) {
            long expectedDays = start.until(end).getDays() + 1;
            if (!cached.isEmpty() && cached.size() >= expectedDays) {
                log.debug("Weather cache hit for {} ({} → {}): {} records", stationCode, start, end, cached.size());
                return buildResponseFromCache(lat, lon, cached);
            }
        }

        // 2. Fetch from Open-Meteo
        log.info("Fetching weather from Open-Meteo for {} ({} → {})", stationCode, start, end);
        try {
            JsonNode raw = fetchFromOpenMeteo(lat, lon, start, end);
            // Filter daily data to the requested date range, excluding zero-temp days
            List<WeatherDay> days = parseDaily(raw).stream()
                    .filter(d -> {
                        LocalDate d1 = LocalDate.parse(d.date());
                        return !d1.isBefore(start) && !d1.isAfter(end);
                    })
                    .toList();
            // Persist to DB (idempotent — skips dates already stored, which `cached`
            // already lists, so no per-day lookups). Re-query for aggregation only
            // when something new was written.
            List<WeatherObservation> saved = saveDailyObservations(lat, lon, start, end, raw, cached);
            List<WeatherObservation> all = saved.isEmpty() ? cached
                    : repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(stationCode, start, end);
            WeatherCurrent current = parseCurrent(raw);
            // The forecast URL always carries PAST_DAYS of hours (~2,200); return only the
            // requested dates — /current was shipping 380 KB for a 3-day window.
            List<WeatherHour> hourly = parseHourly(raw).stream()
                    .filter(h -> inRange(h.time(), start, end))
                    .toList();
            WeatherAggregation agg = computeAggregation(all);
            return new WeatherResponse(lat, lon, current, days, hourly, agg);
        } catch (Exception e) {
            log.warn("Open-Meteo fetch failed for {} ({} → {}): {}", stationCode, start, end, e.getMessage());
            appEventService.warn("weather", "WeatherService",
                    "Open-Meteo fetch failed: " + e.getMessage());
            // Fall back to whatever we have in cache, even if incomplete
            if (!cached.isEmpty()) {
                log.debug("Returning partial cache ({} records) after API failure", cached.size());
                return buildResponseFromCache(lat, lon, cached);
            }
            return emptyResponse(lat, lon);
        }
    }

    /**
     * Replace stored forecasts for days that have passed with the weather that happened.
     * A date's row used to be written once and never touched, so a day first stored a week
     * ahead kept that week-old forecast for good, and the electric forecast trained on it
     * (40 of 91 days were 7+ days stale, 4.8°F off on average). The forecast each prediction
     * was made with is kept in forecast_snapshot, so nothing is lost by overwriting here.
     *
     * Days inside the forecast API's {@link #PAST_DAYS} come from it (already fetched for
     * the Home page, so usually a cache hit); older stale days come from the archive API.
     * The last {@link #SETTLE_DAYS} are refreshed even when already observed, and filled
     * in when missing. Returns the number of rows written.
     */
    public int refreshObservedDays(double lat, double lon) throws Exception {
        LocalDate today = LocalDate.now();
        LocalDate windowStart = today.minusDays(PAST_DAYS);
        LocalDate settleStart = today.minusDays(SETTLE_DAYS);
        String stationCode = formatStationCode(lat, lon);

        Map<LocalDate, WeatherObservation> rows = new TreeMap<>();
        for (WeatherObservation o : repo.findByStationCodeAndSourceAndObservationDateBefore(stationCode, SOURCE_FORECAST, today)) {
            rows.put(o.getObservationDate(), o);
        }
        for (WeatherObservation o : repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                stationCode, settleStart, today.minusDays(1))) {
            rows.put(o.getObservationDate(), o);
        }

        Map<LocalDate, WeatherObservation> observed = new HashMap<>();
        observed.putAll(dailyValues(fetchFromOpenMeteo(lat, lon, today, today.plusDays(1)), SOURCE_OBSERVED));
        LocalDate oldest = rows.isEmpty() ? null : rows.keySet().iterator().next();
        if (oldest != null && oldest.isBefore(windowStart)) {
            observed.putAll(dailyValues(fetchFromOpenMeteo(lat, lon, oldest, windowStart.minusDays(1)), SOURCE_ARCHIVE));
        }

        UUID batchId = UUID.randomUUID();
        int written = 0;
        for (LocalDate date = settleStart; date.isBefore(today); date = date.plusDays(1)) {
            rows.putIfAbsent(date, null);
        }
        for (var e : rows.entrySet()) {
            WeatherObservation fresh = observed.get(e.getKey());
            if (fresh == null || fresh.getAvgTempF() == null) continue;
            WeatherObservation row = e.getValue();
            if (row == null) {
                row = fresh;
                row.setStationCode(stationCode);
            } else if (row.getSource().equals(fresh.getSource()) && sameValues(row, fresh)) {
                continue;
            } else {
                row.setHighTempF(fresh.getHighTempF());
                row.setLowTempF(fresh.getLowTempF());
                row.setAvgTempF(fresh.getAvgTempF());
                row.setPrecipitationInches(fresh.getPrecipitationInches());
                row.setSource(fresh.getSource());
            }
            row.setIngestionBatchId(batchId);
            repo.save(row);
            written++;
        }
        if (written > 0) {
            log.info("Replaced or added observed weather for {} past day(s) at {} (batch {})", written, stationCode, batchId);
        }
        return written;
    }

    private static boolean sameValues(WeatherObservation a, WeatherObservation b) {
        return sameNumber(a.getHighTempF(), b.getHighTempF()) && sameNumber(a.getLowTempF(), b.getLowTempF())
                && sameNumber(a.getAvgTempF(), b.getAvgTempF())
                && sameNumber(a.getPrecipitationInches(), b.getPrecipitationInches());
    }

    private static boolean sameNumber(BigDecimal a, BigDecimal b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }

    /** The response's daily rows for days before today, unsaved, keyed by date. */
    private static Map<LocalDate, WeatherObservation> dailyValues(JsonNode raw, String source) {
        Map<LocalDate, WeatherObservation> out = new HashMap<>();
        JsonNode daily = raw.get("daily");
        if (daily == null || !daily.has("time")) return out;
        LocalDate today = LocalDate.now();
        JsonNode times = daily.get("time");
        for (int i = 0; i < times.size(); i++) {
            LocalDate date = LocalDate.parse(times.get(i).asText());
            if (!date.isBefore(today)) continue;
            out.put(date, WeatherObservation.builder()
                    .observationDate(date)
                    .highTempF(safeDecimal(daily.get("temperature_2m_max"), i))
                    .lowTempF(safeDecimal(daily.get("temperature_2m_min"), i))
                    .avgTempF(safeDecimal(daily.get("temperature_2m_mean"), i))
                    .humidityPct(null)
                    .precipitationInches(safeDecimal(daily.get("precipitation_sum"), i))
                    .source(source)
                    .sourceProvider("open-meteo")
                    .processingVersion("1.0")
                    .build());
        }
        return out;
    }

    // ── Open-Meteo HTTP ─────────────────────────────────────────

    private JsonNode fetchFromOpenMeteo(double lat, double lon, LocalDate start, LocalDate end) throws Exception {
        LocalDate today = LocalDate.now();
        boolean isHistorical = end.isBefore(today);

        String url;
        if (isHistorical) {
            url = buildArchiveUrl(lat, lon, start, end);
        } else {
            url = buildForecastUrl(lat, lon, end);
        }

        CachedResponse hit = responseCache.get(url);
        Instant now = Instant.now();
        if (hit != null && hit.at().plus(RESPONSE_TTL).isAfter(now)) return hit.body();

        log.debug("Open-Meteo request: {}", url);
        String json = restTemplate.getForObject(url, String.class);
        JsonNode body = mapper.readTree(json);
        responseCache.entrySet().removeIf(e -> !e.getValue().at().plus(RESPONSE_TTL).isAfter(now));
        responseCache.put(url, new CachedResponse(now, body));
        return body;
    }

    /** Hourly `time` is local ISO ("YYYY-MM-DDTHH:00"); keep hours whose date is in [start, end]. */
    static boolean inRange(String time, LocalDate start, LocalDate end) {
        if (time == null || time.length() < 10) return false;
        try {
            LocalDate d = LocalDate.parse(time.substring(0, 10));
            return !d.isBefore(start) && !d.isAfter(end);
        } catch (Exception e) {
            return false;
        }
    }

    private String buildForecastUrl(double lat, double lon, LocalDate end) {
        // forecast_days must cover through `end` — this was hardcoded to 2 (enough
        // for getCurrentWeather()'s rolling "next 24 hours" use, since forecast_days=1
        // stops at tonight's midnight) but this same builder is also used for the
        // 7-day/14-day AI forecast request, which needs the API to actually return
        // that many days. A caller asking for `end` = today+14 got only 2 real
        // WeatherDay entries back — capped to Open-Meteo's own max of 16.
        LocalDate today = LocalDate.now();
        int forecastDays = (int) Math.max(2, Math.min(16, ChronoUnit.DAYS.between(today, end) + 1));
        return String.format(Locale.US,
                "%s?latitude=%.4f&longitude=%.4f" +
                "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code" +
                "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code" +
                "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code" +
                "&temperature_unit=fahrenheit" +
                "&precipitation_unit=inch" +
                "&wind_speed_unit=mph" +
                "&timezone=America/Chicago" +
                "&past_days=%d" +
                "&forecast_days=%d",
                FORECAST_URL, lat, lon, PAST_DAYS, forecastDays);
    }

    private String buildArchiveUrl(double lat, double lon, LocalDate start, LocalDate end) {
        return String.format(Locale.US,
                "%s?latitude=%.4f&longitude=%.4f" +
                "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code" +
                "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code" +
                "&temperature_unit=fahrenheit" +
                "&precipitation_unit=inch" +
                "&wind_speed_unit=mph" +
                "&timezone=America/Chicago" +
                "&start_date=%s" +
                "&end_date=%s",
                ARCHIVE_URL, lat, lon, start.toString(), end.toString());
    }

    // ── Persistence ─────────────────────────────────────────────

    /**
     * Store the response's daily rows in [requestStart, requestEnd] that aren't stored yet.
     * {@code existing} is what the caller already loaded for that range — it used to be
     * one exists() query per day (~90 per Utility load, ~250 ms) to learn the same thing.
     */
    private List<WeatherObservation> saveDailyObservations(
            double lat, double lon, LocalDate requestStart, LocalDate requestEnd, JsonNode raw,
            List<WeatherObservation> existing) {

        JsonNode daily = raw.get("daily");
        if (daily == null || !daily.has("time")) {
            log.warn("Open-Meteo response missing daily data");
            return List.of();
        }

        String stationCode = formatStationCode(lat, lon);
        LocalDate today = LocalDate.now();
        // A forecast-API response's past days are what happened; only today on are forecasts.
        boolean archive = requestEnd.isBefore(today);
        UUID batchId = UUID.randomUUID();
        List<WeatherObservation> saved = new ArrayList<>();
        Set<LocalDate> stored = new HashSet<>();
        for (WeatherObservation o : existing) stored.add(o.getObservationDate());

        JsonNode times = daily.get("time");
        JsonNode maxTemps = daily.get("temperature_2m_max");
        JsonNode minTemps = daily.get("temperature_2m_min");
        JsonNode meanTemps = daily.get("temperature_2m_mean");
        JsonNode precip = daily.get("precipitation_sum");
        JsonNode codes = daily.get("weather_code");

        for (int i = 0; i < times.size(); i++) {
            LocalDate date = LocalDate.parse(times.get(i).asText());
            // Only save dates within the requested range
            if (date.isBefore(requestStart) || date.isAfter(requestEnd)) continue;
            // Skip if already stored
            if (stored.contains(date)) continue;

            String source = archive ? SOURCE_ARCHIVE : date.isBefore(today) ? SOURCE_OBSERVED : SOURCE_FORECAST;
            WeatherObservation obs = WeatherObservation.builder()
                    .observationDate(date)
                    .stationCode(stationCode)
                    .highTempF(safeDecimal(maxTemps, i))
                    .lowTempF(safeDecimal(minTemps, i))
                    .avgTempF(safeDecimal(meanTemps, i))
                    .humidityPct(null) // not available at daily granularity from Open-Meteo
                    .precipitationInches(safeDecimal(precip, i))
                    .source(source)
                    .sourceProvider("open-meteo")
                    .ingestionBatchId(batchId)
                    .processingVersion("1.0")
                    .build();
            saved.add(repo.save(obs));
        }
        if (!saved.isEmpty()) {
            log.info("Saved {} weather observations for {} (batch {})", saved.size(), stationCode, batchId);
        }
        return saved;
    }

    // ── Response builders ───────────────────────────────────────

    private WeatherResponse buildResponseFromCache(double lat, double lon, List<WeatherObservation> cached) {
        List<WeatherDay> days = cached.stream().map(o -> new WeatherDay(
                o.getObservationDate().toString(),
                toDouble(o.getLowTempF()),
                toDouble(o.getHighTempF()),
                toDouble(o.getAvgTempF()),
                toDouble(o.getPrecipitationInches()),
                0 // weather code not stored in DB
        )).toList();
        WeatherAggregation agg = computeAggregation(cached);
        return new WeatherResponse(lat, lon, null, days, List.of(), agg);
    }

    private WeatherResponse emptyResponse(double lat, double lon) {
        return new WeatherResponse(lat, lon, null, List.of(), List.of(), null);
    }

    // ── JSON parsing helpers ─────────────────────────────────────

    private WeatherCurrent parseCurrent(JsonNode raw) {
        JsonNode current = raw.get("current");
        if (current == null) return null;
        return new WeatherCurrent(
                current.get("temperature_2m").asDouble(),
                current.get("apparent_temperature").asDouble(),
                current.get("relative_humidity_2m").asDouble(),
                current.get("precipitation").asDouble(),
                current.has("wind_speed_10m") ? current.get("wind_speed_10m").asDouble() : 0.0,
                current.get("weather_code").asInt()
        );
    }

    private List<WeatherDay> parseDaily(JsonNode raw) {
        JsonNode daily = raw.get("daily");
        if (daily == null || !daily.has("time")) return List.of();

        List<WeatherDay> days = new ArrayList<>();
        JsonNode times = daily.get("time");
        for (int i = 0; i < times.size(); i++) {
            days.add(new WeatherDay(
                    times.get(i).asText(),
                    safeDouble(daily.get("temperature_2m_min"), i),
                    safeDouble(daily.get("temperature_2m_max"), i),
                    safeDouble(daily.get("temperature_2m_mean"), i),
                    safeDouble(daily.get("precipitation_sum"), i),
                    safeInt(daily.get("weather_code"), i)
            ));
        }
        return days;
    }

    private List<WeatherHour> parseHourly(JsonNode raw) {
        JsonNode hourly = raw.get("hourly");
        if (hourly == null || !hourly.has("time")) return List.of();

        List<WeatherHour> hours = new ArrayList<>();
        JsonNode times = hourly.get("time");
        for (int i = 0; i < times.size(); i++) {
            hours.add(new WeatherHour(
                    times.get(i).asText(),
                    safeDouble(hourly.get("temperature_2m"), i),
                    safeDouble(hourly.get("apparent_temperature"), i),
                    safeDouble(hourly.get("relative_humidity_2m"), i),
                    safeDouble(hourly.get("precipitation"), i),
                    safeDouble(hourly.get("precipitation_probability"), i),
                    safeDouble(hourly.get("wind_speed_10m"), i),
                    safeInt(hourly.get("weather_code"), i)
            ));
        }
        return hours;
    }

    // ── Aggregation ─────────────────────────────────────────────

    WeatherAggregation computeAggregation(List<WeatherObservation> observations) {
        if (observations == null || observations.isEmpty()) return null;

        double sumTemp = 0;
        double minTemp = Double.MAX_VALUE;
        double maxTemp = Double.MIN_VALUE;
        double totalPrecip = 0;
        double hdd = 0;
        int tempCount = 0;

        for (WeatherObservation o : observations) {
            if (o.getAvgTempF() != null && o.getAvgTempF().doubleValue() > 0) {
                double t = o.getAvgTempF().doubleValue();
                sumTemp += t;
                tempCount++;
                if (t < minTemp) minTemp = t;
                if (t > maxTemp) maxTemp = t;
                hdd += Math.max(0, HDD_BASE_TEMP - t);
            }
            if (o.getPrecipitationInches() != null) {
                totalPrecip += o.getPrecipitationInches().doubleValue();
            }
        }

        if (tempCount == 0) return null;

        return new WeatherAggregation(
                round2(sumTemp / tempCount),
                round2(minTemp == Double.MAX_VALUE ? null : minTemp),
                round2(maxTemp == Double.MIN_VALUE ? null : maxTemp),
                round2(totalPrecip),
                round2(hdd)
        );
    }

    // ── Helpers ─────────────────────────────────────────────────

    private static String formatStationCode(double lat, double lon) {
        return String.format(Locale.US, "%.4f,%.4f", lat, lon);
    }

    private static BigDecimal safeDecimal(JsonNode array, int index) {
        if (array == null || index >= array.size() || array.get(index).isNull()) return null;
        return BigDecimal.valueOf(array.get(index).asDouble());
    }

    private static double safeDouble(JsonNode array, int index) {
        if (array == null || index >= array.size() || array.get(index).isNull()) return 0.0;
        return array.get(index).asDouble();
    }

    private static int safeInt(JsonNode array, int index) {
        if (array == null || index >= array.size() || array.get(index).isNull()) return 0;
        return array.get(index).asInt();
    }

    private static double toDouble(BigDecimal bd) {
        return bd == null ? 0.0 : bd.doubleValue();
    }

    private static Double round2(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static Double round2(Double value) {
        return value == null ? null : round2(value.doubleValue());
    }
}
