package com.homeplatform.dto;

import java.util.List;

public record WeatherResponse(
        double latitude,
        double longitude,
        WeatherCurrent current,
        List<WeatherDay> daily,
        List<WeatherHour> hourly,
        WeatherAggregation aggregation
) {
    public record WeatherCurrent(
            double temperature,
            double apparentTemperature,
            double humidity,
            double precipitation,
            int weatherCode
    ) {}

    public record WeatherDay(
            String date,
            double minTemperature,
            double maxTemperature,
            double meanTemperature,
            double precipitation,
            int weatherCode
    ) {}

    public record WeatherHour(
            String time,
            double temperature,
            double apparentTemperature,
            double humidity,
            double precipitation,
            int weatherCode
    ) {}

    public record WeatherAggregation(
            Double averageTemperature,
            Double minTemperature,
            Double maxTemperature,
            Double totalPrecipitation,
            Double heatingDegreeDays
    ) {}
}
