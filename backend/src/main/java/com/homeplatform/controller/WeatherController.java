package com.homeplatform.controller;

import com.homeplatform.dto.WeatherOutlook;
import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.service.WeatherService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

@RestController
@RequestMapping("/api/weather")
public class WeatherController {

    private static final Logger log = LoggerFactory.getLogger(WeatherController.class);

    private final WeatherService weatherService;

    @Value("${app.property-latitude}")
    private double propertyLatitude;

    @Value("${app.property-longitude}")
    private double propertyLongitude;

    public WeatherController(WeatherService weatherService) {
        this.weatherService = weatherService;
    }

    @GetMapping("/current")
    public ResponseEntity<WeatherResponse> getCurrentWeather() {
        WeatherResponse response = weatherService.getCurrentWeather(propertyLatitude, propertyLongitude);
        return ResponseEntity.ok(response);
    }

    /**
     * The week ahead (today + 6 days), daily, for Home's week view. Same access as /current
     * (any signed-in member or guest). 503 when Open-Meteo can't be reached, so the page shows
     * a failed load (or keeps the week it already has) instead of an empty week.
     */
    @GetMapping("/outlook")
    public ResponseEntity<WeatherOutlook> getWeekOutlook() {
        try {
            return ResponseEntity.ok(weatherService.getWeekOutlook(propertyLatitude, propertyLongitude));
        } catch (Exception e) {
            log.warn("Week outlook fetch failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    @GetMapping("/range")
    public ResponseEntity<WeatherResponse> getWeatherForRange(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate end) {
        WeatherResponse response = weatherService.getWeatherForDateRange(
                propertyLatitude, propertyLongitude, start, end);
        return ResponseEntity.ok(response);
    }
}
