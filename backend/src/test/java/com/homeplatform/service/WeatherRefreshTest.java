package com.homeplatform.service;

import com.homeplatform.dto.WeatherResponse.WeatherDay;
import com.homeplatform.model.WeatherObservation;
import com.homeplatform.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Stored forecasts for past days are replaced with the weather that happened. */
class WeatherRefreshTest {

    private static final double LAT = 33.2150, LON = -97.1330;
    private static final String STATION = "33.2150,-97.1330";
    private static final LocalDate TODAY = LocalDate.now();

    private WeatherObservationRepository repo;
    private RestTemplate rest;
    private WeatherService service;

    @BeforeEach
    void setUp() {
        repo = mock(WeatherObservationRepository.class);
        rest = mock(RestTemplate.class);
        service = new WeatherService(repo, rest, mock(AppEventService.class));
        when(repo.save(any(WeatherObservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(repo.findByStationCodeAndSourceAndObservationDateBefore(anyString(), anyString(), any())).thenReturn(List.of());
        when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(anyString(), any(), any()))
                .thenReturn(List.of());
    }

    /** Open-Meteo daily JSON for {@code from}..{@code to}, each day's mean from {@code mean}. */
    private static String json(LocalDate from, LocalDate to, Function<LocalDate, Double> mean) {
        List<String> t = new ArrayList<>(), hi = new ArrayList<>(), lo = new ArrayList<>(), avg = new ArrayList<>(), p = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            Double m = mean.apply(d);
            t.add("\"" + d + "\"");
            hi.add(m == null ? "null" : String.valueOf(m + 8));
            lo.add(m == null ? "null" : String.valueOf(m - 8));
            avg.add(String.valueOf(m));
            p.add("0.0");
        }
        return """
            {"daily": {"time": [%s], "temperature_2m_max": [%s], "temperature_2m_min": [%s],
                       "temperature_2m_mean": [%s], "precipitation_sum": [%s], "weather_code": [%s]}}
            """.formatted(String.join(",", t), String.join(",", hi), String.join(",", lo),
                String.join(",", avg), String.join(",", p), String.join(",", p.stream().map(x -> "0").toList()));
    }

    private static WeatherObservation stored(LocalDate date, double avg, String source) {
        return WeatherObservation.builder()
                .observationDate(date).stationCode(STATION)
                .avgTempF(BigDecimal.valueOf(avg)).highTempF(BigDecimal.valueOf(avg + 8)).lowTempF(BigDecimal.valueOf(avg - 8))
                .precipitationInches(BigDecimal.valueOf(0.0))
                .source(source).sourceProvider("open-meteo").build();
    }

    private Map<LocalDate, WeatherObservation> saved(int times) {
        ArgumentCaptor<WeatherObservation> c = ArgumentCaptor.forClass(WeatherObservation.class);
        verify(repo, times(times)).save(c.capture());
        return c.getAllValues().stream().collect(Collectors.toMap(WeatherObservation::getObservationDate, o -> o));
    }

    @Test
    @DisplayName("a past day's stored forecast becomes the observed weather; today's forecast is left alone")
    void replacesStaleForecast() throws Exception {
        LocalDate stale = TODAY.minusDays(5);
        WeatherObservation row = stored(stale, 75.6, WeatherService.SOURCE_FORECAST);
        when(repo.findByStationCodeAndSourceAndObservationDateBefore(STATION, WeatherService.SOURCE_FORECAST, TODAY))
                .thenReturn(List.of(row));
        // The last two days are already observed and unchanged.
        when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(STATION, TODAY.minusDays(2), TODAY.minusDays(1)))
                .thenReturn(List.of(stored(TODAY.minusDays(2), 70, WeatherService.SOURCE_OBSERVED),
                        stored(TODAY.minusDays(1), 70, WeatherService.SOURCE_OBSERVED)));
        when(rest.getForObject(contains("api.open-meteo.com/v1/forecast"), eq(String.class)))
                .thenReturn(json(TODAY.minusDays(92), TODAY.plusDays(1), d -> d.equals(stale) ? 62.0 : 70.0));

        assertEquals(1, service.refreshObservedDays(LAT, LON));

        WeatherObservation fixed = saved(1).get(stale);
        assertSame(row, fixed, "updated in place, not a second row for the date");
        assertEquals(0, fixed.getAvgTempF().compareTo(BigDecimal.valueOf(62.0)));
        assertEquals(0, fixed.getHighTempF().compareTo(BigDecimal.valueOf(70.0)));
        assertEquals(WeatherService.SOURCE_OBSERVED, fixed.getSource());
        verify(rest, never()).getForObject(contains("archive-api"), eq(String.class));
    }

    @Test
    @DisplayName("the last two days are refreshed when they shift, and filled in when missing")
    void settlesRecentDays() throws Exception {
        when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(STATION, TODAY.minusDays(2), TODAY.minusDays(1)))
                .thenReturn(List.of(stored(TODAY.minusDays(1), 70, WeatherService.SOURCE_OBSERVED)));
        when(rest.getForObject(contains("api.open-meteo.com/v1/forecast"), eq(String.class)))
                .thenReturn(json(TODAY.minusDays(92), TODAY.plusDays(1), d -> 71.5));

        assertEquals(2, service.refreshObservedDays(LAT, LON));

        Map<LocalDate, WeatherObservation> rows = saved(2);
        assertEquals(0, rows.get(TODAY.minusDays(1)).getAvgTempF().compareTo(BigDecimal.valueOf(71.5)));
        WeatherObservation added = rows.get(TODAY.minusDays(2));
        assertEquals(STATION, added.getStationCode());
        assertEquals(WeatherService.SOURCE_OBSERVED, added.getSource());
    }

    @Test
    @DisplayName("stale forecasts older than the forecast API's past days come from the archive")
    void oldStaleDaysUseArchive() throws Exception {
        LocalDate old = TODAY.minusDays(100);
        when(repo.findByStationCodeAndSourceAndObservationDateBefore(STATION, WeatherService.SOURCE_FORECAST, TODAY))
                .thenReturn(List.of(stored(old, 90, WeatherService.SOURCE_FORECAST)));
        when(rest.getForObject(contains("api.open-meteo.com/v1/forecast"), eq(String.class)))
                .thenReturn(json(TODAY.minusDays(92), TODAY.plusDays(1), d -> 70.0));
        when(rest.getForObject(contains("archive-api"), eq(String.class)))
                .thenReturn(json(old, TODAY.minusDays(93), d -> 84.0));

        service.refreshObservedDays(LAT, LON);

        WeatherObservation fixed = saved(3).get(old); // plus the two missing recent days
        assertEquals(0, fixed.getAvgTempF().compareTo(BigDecimal.valueOf(84.0)));
        assertEquals(WeatherService.SOURCE_ARCHIVE, fixed.getSource());
        verify(rest).getForObject(contains("start_date=" + old + "&end_date=" + old), eq(String.class));
    }

    @Test
    @DisplayName("days the forecast API leaves blank (past ~2 months) come from the archive; recent blanks wait")
    void blankForecastDaysUseArchive() throws Exception {
        LocalDate blank = TODAY.minusDays(70), tooRecent = TODAY.minusDays(3);
        when(repo.findByStationCodeAndSourceAndObservationDateBefore(STATION, WeatherService.SOURCE_FORECAST, TODAY))
                .thenReturn(List.of(stored(blank, 90, WeatherService.SOURCE_FORECAST),
                        stored(tooRecent, 90, WeatherService.SOURCE_FORECAST)));
        when(repo.findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(STATION, TODAY.minusDays(2), TODAY.minusDays(1)))
                .thenReturn(List.of(stored(TODAY.minusDays(2), 70, WeatherService.SOURCE_OBSERVED),
                        stored(TODAY.minusDays(1), 70, WeatherService.SOURCE_OBSERVED)));
        when(rest.getForObject(contains("api.open-meteo.com/v1/forecast"), eq(String.class)))
                .thenReturn(json(TODAY.minusDays(92), TODAY.plusDays(1),
                        d -> d.isBefore(TODAY.minusDays(67)) || d.equals(tooRecent) ? null : 70.0));
        when(rest.getForObject(contains("archive-api"), eq(String.class)))
                .thenReturn(json(blank, blank, d -> 86.0));

        assertEquals(1, service.refreshObservedDays(LAT, LON));

        WeatherObservation fixed = saved(1).get(blank);
        assertEquals(0, fixed.getAvgTempF().compareTo(BigDecimal.valueOf(86.0)));
        assertEquals(WeatherService.SOURCE_ARCHIVE, fixed.getSource());
        verify(rest).getForObject(contains("start_date=" + blank + "&end_date=" + blank), eq(String.class));
    }

    @Test
    @DisplayName("a new forecast-API fetch labels past days observed and only today on as forecasts")
    void labelsNewRowsBySource() {
        when(rest.getForObject(anyString(), eq(String.class)))
                .thenReturn(json(TODAY.minusDays(92), TODAY.plusDays(1), d -> 70.0));

        service.getWeatherForDateRange(LAT, LON, TODAY.minusDays(1), TODAY.plusDays(1));

        Map<LocalDate, WeatherObservation> rows = saved(3);
        assertEquals(WeatherService.SOURCE_OBSERVED, rows.get(TODAY.minusDays(1)).getSource());
        assertEquals(WeatherService.SOURCE_FORECAST, rows.get(TODAY).getSource());
        assertEquals(WeatherService.SOURCE_FORECAST, rows.get(TODAY.plusDays(1)).getSource());
    }

    @Test
    @DisplayName("forecast days use the daily mean, falling back to the high/low midpoint")
    void dailyMean() {
        assertEquals(78.4, new WeatherDay("2026-10-24", 70, 90, 78.4, 0, 0).avgTemperature(), 1e-9);
        assertEquals(80.0, new WeatherDay("2026-10-24", 70, 90, 0, 0, 0).avgTemperature(), 1e-9);
        assertEquals(0.0, new WeatherDay("2026-10-24", -5, 5, 0, 0, 0).avgTemperature(), 1e-9);
    }
}
