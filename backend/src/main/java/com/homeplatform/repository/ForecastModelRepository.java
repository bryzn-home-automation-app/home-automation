package com.homeplatform.repository;

import com.homeplatform.model.ForecastModel;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ForecastModelRepository extends JpaRepository<ForecastModel, Long> {

    Optional<ForecastModel> findFirstByOrderByCreatedAtDesc();
}
