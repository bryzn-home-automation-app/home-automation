package com.homeplatform.controller;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.service.WeatherService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

@RestController
@RequestMapping("/api/weather")
public class WeatherController {

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

    @GetMapping("/range")
    public ResponseEntity<WeatherResponse> getWeatherForRange(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate end) {
        WeatherResponse response = weatherService.getWeatherForDateRange(
                propertyLatitude, propertyLongitude, start, end);
        return ResponseEntity.ok(response);
    }
}
