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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class WeatherService {

    private static final Logger log = LoggerFactory.getLogger(WeatherService.class);
    private static final String FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
    private static final String ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
    private static final double HDD_BASE_TEMP = 65.0;
    private static final int PAST_DAYS = 92;
    private static final ObjectMapper mapper = new ObjectMapper();

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
            // Persist to DB (idempotent — skips already-cached dates)
            saveDailyObservations(lat, lon, start, end, raw);
            // Re-query the full range from DB for aggregation (cached + newly saved)
            List<WeatherObservation> all = repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                    stationCode, start, end);
            WeatherCurrent current = parseCurrent(raw);
            List<WeatherHour> hourly = parseHourly(raw);
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

    // ── Open-Meteo HTTP ─────────────────────────────────────────

    private JsonNode fetchFromOpenMeteo(double lat, double lon, LocalDate start, LocalDate end) throws Exception {
        LocalDate today = LocalDate.now();
        boolean isHistorical = end.isBefore(today);

        String url;
        if (isHistorical) {
            url = buildArchiveUrl(lat, lon, start, end);
        } else {
            url = buildForecastUrl(lat, lon);
        }

        log.debug("Open-Meteo request: {}", url);
        String json = restTemplate.getForObject(url, String.class);
        return mapper.readTree(json);
    }

    private String buildForecastUrl(double lat, double lon) {
        return String.format(Locale.US,
                "%s?latitude=%.4f&longitude=%.4f" +
                "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code" +
                "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code" +
                "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code" +
                "&temperature_unit=fahrenheit" +
                "&precipitation_unit=inch" +
                "&timezone=America/Chicago" +
                "&past_days=%d" +
                "&forecast_days=1",
                FORECAST_URL, lat, lon, PAST_DAYS);
    }

    private String buildArchiveUrl(double lat, double lon, LocalDate start, LocalDate end) {
        return String.format(Locale.US,
                "%s?latitude=%.4f&longitude=%.4f" +
                "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code" +
                "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weather_code" +
                "&temperature_unit=fahrenheit" +
                "&precipitation_unit=inch" +
                "&timezone=America/Chicago" +
                "&start_date=%s" +
                "&end_date=%s",
                ARCHIVE_URL, lat, lon, start.toString(), end.toString());
    }

    // ── Persistence ─────────────────────────────────────────────

    private List<WeatherObservation> saveDailyObservations(
            double lat, double lon, LocalDate requestStart, LocalDate requestEnd, JsonNode raw) {

        JsonNode daily = raw.get("daily");
        if (daily == null || !daily.has("time")) {
            log.warn("Open-Meteo response missing daily data");
            return List.of();
        }

        String stationCode = formatStationCode(lat, lon);
        String source = requestEnd.isBefore(LocalDate.now()) ? "open-meteo-archive" : "open-meteo-forecast";
        UUID batchId = UUID.randomUUID();
        List<WeatherObservation> saved = new ArrayList<>();

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
            // Skip if already cached
            if (repo.existsByStationCodeAndObservationDate(stationCode, date)) continue;

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
        log.info("Saved {} weather observations for {} (batch {})", saved.size(), stationCode, batchId);
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
