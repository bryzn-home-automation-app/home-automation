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
            double windSpeed,
            int weatherCode
    ) {}

    public record WeatherDay(
            String date,
            double minTemperature,
            double maxTemperature,
            double meanTemperature,
            double precipitation,
            int weatherCode
    ) {
        /**
         * The day's mean temperature, the same measure the forecast model trains on.
         * Falls back to (high + low) / 2 when the mean is missing (stored as 0) or
         * outside the high/low range.
         */
        public double avgTemperature() {
            boolean usable = meanTemperature >= minTemperature && meanTemperature <= maxTemperature
                    && !(meanTemperature == 0 && minTemperature == 0 && maxTemperature == 0);
            return usable ? meanTemperature : (maxTemperature + minTemperature) / 2;
        }
    }

    public record WeatherHour(
            String time,
            double temperature,
            double apparentTemperature,
            double humidity,
            double precipitation,
            double precipitationProbability,
            double windSpeed,
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
