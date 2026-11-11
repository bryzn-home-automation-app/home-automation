package com.homeplatform.dto;

import java.util.List;

/**
 * The week ahead at the property, one row per home calendar day starting today (Home's
 * "Week" weather view). Read straight from Open-Meteo's daily forecast and never stored:
 * weather_observations stays the job of {@link com.homeplatform.service.WeatherService}'s
 * range fetch and its observed-day refresh.
 *
 * Every figure is nullable: Open-Meteo leaves a value null when its models don't reach that
 * far, and a missing temperature must not read as 0°.
 */
public record WeatherOutlook(
        double latitude,
        double longitude,
        List<Day> days
) {
    public record Day(
            /** "2026-11-12", the home's calendar day. */
            String date,
            Double maxTemperature,
            Double minTemperature,
            /** The day's highest hourly chance of rain, 0–100. */
            Double precipitationProbability,
            /** Inches. */
            Double precipitation,
            /** WMO code. */
            Integer weatherCode,
            /** Home wall-clock, "2026-11-12T06:59". */
            String sunrise,
            String sunset,
            /** mph. */
            Double windSpeedMax
    ) {}
}
