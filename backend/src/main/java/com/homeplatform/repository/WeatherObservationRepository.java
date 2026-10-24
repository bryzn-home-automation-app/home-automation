package com.homeplatform.repository;

import com.homeplatform.model.WeatherObservation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface WeatherObservationRepository extends JpaRepository<WeatherObservation, Long> {

    List<WeatherObservation> findByStationCodeAndObservationDateBetweenOrderByObservationDateAsc(
            String stationCode, LocalDate start, LocalDate end);

    /** Rows from {@code source} dated before {@code date}: stored forecasts for days that have passed. */
    List<WeatherObservation> findByStationCodeAndSourceAndObservationDateBefore(
            String stationCode, String source, LocalDate date);

    boolean existsByStationCodeAndObservationDate(String stationCode, LocalDate observationDate);
}
