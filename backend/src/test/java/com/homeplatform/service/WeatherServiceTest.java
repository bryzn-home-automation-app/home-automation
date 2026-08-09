package com.homeplatform.service;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.model.WeatherObservation;
import com.homeplatform.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class WeatherServiceTest {

    private WeatherService weatherService;
    private WeatherObservationRepository repo;
    private RestTemplate restTemplate;

    private static final double LAT = 33.2150;
    private static final double LON = -97.1330;

    @BeforeEach
    void setUp() {
        repo = mock(WeatherObservationRepository.class);
        restTemplate = mock(RestTemplate.class);
        weatherService = new WeatherService(repo, restTemplate);
    }

    // ── Sample Open-Meteo JSON ──────────────────────────────────

    private String forecastJson() {
        return """
        {
          "latitude": 33.215,
          "longitude": -97.133,
          "current": {
            "temperature_2m": 95.4,
            "apparent_temperature": 98.1,
            "relative_humidity_2m": 55,
            "precipitation": 0.0,
            "weather_code": 0
          },
          "daily": {
            "time": ["2026-08-05","2026-08-06","2026-08-07","2026-08-08","2026-08-09"],
            "temperature_2m_max": [96.0, 94.0, 97.0, 92.0, 95.0],
            "temperature_2m_min": [74.0, 72.0, 75.0, 71.0, 73.0],
            "temperature_2m_mean": [85.0, 83.0, 86.0, 81.5, 84.0],
            "precipitation_sum": [0.0, 0.1, 0.0, 0.5, 0.0],
            "weather_code": [0, 1, 0, 61, 0]
          }
        }
        """;
    }

    private String archiveJson() {
        return """
        {
          "latitude": 33.215,
          "longitude": -97.133,
          "daily": {
            "time": ["2026-01-10","2026-01-11","2026-01-12"],
            "temperature_2m_max": [52.0, 48.0, 55.0],
            "temperature_2m_min": [31.0, 28.0, 34.0],
            "temperature_2m_mean": [41.5, 38.0, 44.5],
            "precipitation_sum": [0.2, 0.0, 0.8],
            "weather_code": [61, 0, 63]
          }
        }
        """;
    }

    // ── Tests ───────────────────────────────────────────────────

    @Nested
    @DisplayName("Forecast API")
    class ForecastApi {

        @Test
        @DisplayName("should call forecast API and persist observations")
        void fetchesAndPersists() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenReturn(forecastJson());
            when(repo.existsByStationCodeAndObservationDate(anyString(), any()))
                    .thenReturn(false);
            when(repo.save(any(WeatherObservation.class)))
                    .thenAnswer(inv -> inv.getArgument(0));

            LocalDate start = LocalDate.of(2026, 8, 5);
            LocalDate end = LocalDate.of(2026, 8, 9);

            // First findBy call: cache miss → triggers API
            // Second findBy call: re-query after save → return saved-like records for aggregation
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                    anyString(), any(), any()))
                    .thenReturn(List.of())  // cache miss on first call
                    .thenReturn(List.of(    // re-query after save on second call
                            buildObs("2026-08-05", 85.0),
                            buildObs("2026-08-06", 83.0),
                            buildObs("2026-08-07", 86.0),
                            buildObs("2026-08-08", 81.5),
                            buildObs("2026-08-09", 84.0)
                    ));

            WeatherResponse resp = weatherService.getWeatherForDateRange(LAT, LON, start, end);

            assertNotNull(resp);
            assertEquals(LAT, resp.latitude());
            assertEquals(LON, resp.longitude());

            // Current should be present (forecast includes current)
            assertNotNull(resp.current());
            assertEquals(95.4, resp.current().temperature());

            // Hourly should be present
            assertNotNull(resp.hourly());

            // Daily should have entries
            assertFalse(resp.daily().isEmpty());

            // Aggregation should be computed
            assertNotNull(resp.aggregation());
            assertNotNull(resp.aggregation().averageTemperature());
            assertNotNull(resp.aggregation().minTemperature());
            assertNotNull(resp.aggregation().maxTemperature());
            assertNotNull(resp.aggregation().totalPrecipitation());

            verify(restTemplate, times(1)).getForObject(anyString(), eq(String.class));
        }

        @Test
        @DisplayName("should return from cache without calling API on second request")
        void usesCacheOnSecondCall() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenReturn(archiveJson());  // archive because dates must be older than 2 days
            when(repo.existsByStationCodeAndObservationDate(anyString(), any()))
                    .thenReturn(false);
            when(repo.save(any(WeatherObservation.class)))
                    .thenAnswer(inv -> inv.getArgument(0));

            // Use old dates so the isRecent check allows cache hits
            LocalDate start = LocalDate.of(2026, 1, 10);
            LocalDate end = LocalDate.of(2026, 1, 12);

            // First call — returns empty cache, triggers API
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                    anyString(), any(), any()))
                    .thenReturn(List.of())  // cache miss
                    .thenReturn(List.of(    // re-query after save
                            buildObs("2026-01-10", 41.5),
                            buildObs("2026-01-11", 38.0),
                            buildObs("2026-01-12", 44.5)
                    ));
            weatherService.getWeatherForDateRange(LAT, LON, start, end);
            verify(restTemplate, times(1)).getForObject(anyString(), eq(String.class));

            // Second call — returns full cache, no API call (dates are old, cache allowed)
            reset(restTemplate);
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                    anyString(), any(), any()))
                    .thenReturn(List.of(
                            buildObs("2026-01-10", 41.5),
                            buildObs("2026-01-11", 38.0),
                            buildObs("2026-01-12", 44.5)
                    ));

            WeatherResponse resp2 = weatherService.getWeatherForDateRange(LAT, LON, start, end);
            verify(restTemplate, never()).getForObject(anyString(), eq(String.class));
            assertNotNull(resp2.aggregation());
        }

        @Test
        @DisplayName("should use Fahrenheit units in URL parameters")
        void usesFahrenheitUnits() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenReturn(forecastJson());
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(anyString(), any(), any()))
                    .thenReturn(List.of())
                    .thenReturn(List.of(buildObs("2026-08-05", 85.0)));
            when(repo.existsByStationCodeAndObservationDate(anyString(), any()))
                    .thenReturn(false);
            when(repo.save(any(WeatherObservation.class)))
                    .thenAnswer(inv -> inv.getArgument(0));

            weatherService.getWeatherForDateRange(LAT, LON,
                    LocalDate.of(2026, 8, 5), LocalDate.of(2026, 8, 9));

            // Verify URL contains Fahrenheit and inch parameters
            verify(restTemplate).getForObject(
                    contains("temperature_unit=fahrenheit"),
                    eq(String.class));
        }
    }

    @Nested
    @DisplayName("Archive API")
    class ArchiveApi {

        @Test
        @DisplayName("should use archive endpoint for historical dates")
        void usesArchiveForHistory() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenReturn(archiveJson());
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(anyString(), any(), any()))
                    .thenReturn(List.of())
                    .thenReturn(List.of(
                            buildObs("2026-01-10", 41.5),
                            buildObs("2026-01-11", 38.0),
                            buildObs("2026-01-12", 44.5)
                    ));
            when(repo.existsByStationCodeAndObservationDate(anyString(), any()))
                    .thenReturn(false);
            when(repo.save(any(WeatherObservation.class)))
                    .thenAnswer(inv -> inv.getArgument(0));

            LocalDate start = LocalDate.of(2026, 1, 10);
            LocalDate end = LocalDate.of(2026, 1, 12);

            WeatherResponse resp = weatherService.getWeatherForDateRange(LAT, LON, start, end);

            assertNotNull(resp);
            assertFalse(resp.daily().isEmpty());

            // Verify archive endpoint was used
            verify(restTemplate).getForObject(
                    contains("archive-api"),
                    eq(String.class));
        }
    }

    @Nested
    @DisplayName("Error handling")
    class ErrorHandling {

        @Test
        @DisplayName("should return empty response when Open-Meteo fails")
        void returnsEmptyOnFailure() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenThrow(new RestClientException("Connection refused"));
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(anyString(), any(), any()))
                    .thenReturn(List.of());

            LocalDate start = LocalDate.of(2026, 8, 5);
            LocalDate end = LocalDate.of(2026, 8, 9);

            WeatherResponse resp = weatherService.getWeatherForDateRange(LAT, LON, start, end);

            assertNotNull(resp);
            assertNull(resp.current());
            assertTrue(resp.daily().isEmpty());
            assertNull(resp.aggregation());
        }

        @Test
        @DisplayName("should return partial cache after API failure")
        void returnsPartialCacheOnFailure() {
            WeatherObservation cached = buildObs("2026-08-05", 85.0);
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
                    anyString(), any(), any()))
                    .thenReturn(List.of(cached)); // partial cache

            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenThrow(new RestClientException("Timeout"));

            WeatherResponse resp = weatherService.getWeatherForDateRange(LAT, LON,
                    LocalDate.of(2026, 8, 5), LocalDate.of(2026, 8, 6));

            // Should return cached data even though API failed
            assertNotNull(resp);
            assertNotNull(resp.aggregation());
            assertNotNull(resp.aggregation().averageTemperature());
        }
    }

    @Nested
    @DisplayName("Aggregation")
    class Aggregation {

        @Test
        @DisplayName("should compute correct HDD (heating degree days)")
        void computesHDD() {
            WeatherObservation o1 = buildObs("2026-01-10", 41.5); // HDD = 65 - 41.5 = 23.5
            WeatherObservation o2 = buildObs("2026-01-11", 38.0); // HDD = 65 - 38.0 = 27.0
            WeatherObservation o3 = buildObs("2026-01-12", 70.0); // HDD = 0 (above 65)
            // Total HDD = 23.5 + 27.0 + 0 = 50.5

            WeatherResponse.WeatherAggregation agg = weatherService.computeAggregation(
                    List.of(o1, o2, o3));

            assertNotNull(agg);
            assertEquals(50.5, agg.heatingDegreeDays(), 0.01);
            assertEquals(38.0, agg.minTemperature(), 0.01);
            assertEquals(70.0, agg.maxTemperature(), 0.01);
            assertEquals(49.83, agg.averageTemperature(), 0.01);
        }

        @Test
        @DisplayName("should compute correct average and min/max temperatures")
        void computesTempAggregation() {
            WeatherObservation o1 = buildObs("2026-08-05", 85.0);
            WeatherObservation o2 = buildObs("2026-08-06", 83.0);
            WeatherObservation o3 = buildObs("2026-08-07", 86.0);

            WeatherResponse.WeatherAggregation agg = weatherService.computeAggregation(
                    List.of(o1, o2, o3));

            assertNotNull(agg);
            assertEquals(84.67, agg.averageTemperature(), 0.01);
            assertEquals(83.0, agg.minTemperature(), 0.01);
            assertEquals(86.0, agg.maxTemperature(), 0.01);
            assertEquals(0.0, agg.heatingDegreeDays(), 0.01);
        }

        @Test
        @DisplayName("should sum precipitation correctly")
        void sumsPrecipitation() {
            WeatherObservation o1 = buildObsWithPrecip("2026-08-05", 0.2);
            WeatherObservation o2 = buildObsWithPrecip("2026-08-06", 0.0);
            WeatherObservation o3 = buildObsWithPrecip("2026-08-07", 0.8);

            WeatherResponse.WeatherAggregation agg = weatherService.computeAggregation(
                    List.of(o1, o2, o3));

            assertNotNull(agg);
            assertEquals(1.0, agg.totalPrecipitation(), 0.01);
        }

        @Test
        @DisplayName("should return null aggregation for empty observation list")
        void nullForEmptyList() {
            WeatherResponse.WeatherAggregation agg = weatherService.computeAggregation(List.of());
            assertNull(agg);
        }

        @Test
        @DisplayName("should return null aggregation for null input")
        void nullForNullInput() {
            WeatherResponse.WeatherAggregation agg = weatherService.computeAggregation(null);
            assertNull(agg);
        }

        private WeatherObservation buildObs(String date, double avgTemp) {
            return WeatherObservation.builder()
                    .observationDate(LocalDate.parse(date))
                    .stationCode("33.2150,-97.1330")
                    .avgTempF(new BigDecimal(avgTemp))
                    .highTempF(new BigDecimal(avgTemp + 5))
                    .lowTempF(new BigDecimal(avgTemp - 5))
                    .precipitationInches(BigDecimal.ZERO)
                    .source("open-meteo-forecast")
                    .sourceProvider("open-meteo")
                    .build();
        }

        private WeatherObservation buildObsWithPrecip(String date, double precip) {
            return WeatherObservation.builder()
                    .observationDate(LocalDate.parse(date))
                    .stationCode("33.2150,-97.1330")
                    .avgTempF(new BigDecimal("80.0"))
                    .highTempF(new BigDecimal("85.0"))
                    .lowTempF(new BigDecimal("75.0"))
                    .precipitationInches(new BigDecimal(precip))
                    .source("open-meteo-forecast")
                    .sourceProvider("open-meteo")
                    .build();
        }
    }

    @Nested
    @DisplayName("Current weather")
    class CurrentWeather {

        @Test
        @DisplayName("should return current weather via forecast API")
        void returnsCurrentWeather() {
            when(restTemplate.getForObject(anyString(), eq(String.class)))
                    .thenReturn(forecastJson());
            when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(anyString(), any(), any()))
                    .thenReturn(List.of())
                    .thenReturn(List.of(buildObs("2026-08-08", 85.0)));
            when(repo.existsByStationCodeAndObservationDate(anyString(), any()))
                    .thenReturn(false);
            when(repo.save(any(WeatherObservation.class)))
                    .thenAnswer(inv -> inv.getArgument(0));

            WeatherResponse resp = weatherService.getCurrentWeather(LAT, LON);

            assertNotNull(resp);
            assertNotNull(resp.current());
            assertEquals(95.4, resp.current().temperature());
            assertEquals(55, resp.current().humidity(), 0.01);
        }
    }

    // ── Helpers ─────────────────────────────────────────────────

    private WeatherObservation buildObs(String dateStr, double avgTemp) {
        return WeatherObservation.builder()
                .observationDate(LocalDate.parse(dateStr))
                .stationCode("33.2150,-97.1330")
                .avgTempF(new BigDecimal(avgTemp))
                .highTempF(new BigDecimal(avgTemp + 5))
                .lowTempF(new BigDecimal(avgTemp - 5))
                .precipitationInches(BigDecimal.ZERO)
                .source("open-meteo-forecast")
                .sourceProvider("open-meteo")
                .build();
    }
}
