package com.homeplatform.repository;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.WeatherAlertSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface WeatherAlertSettingRepository extends JpaRepository<WeatherAlertSetting, Long> {

    List<WeatherAlertSetting> findByUserId(Long userId);

    Optional<WeatherAlertSetting> findByUserIdAndAlertType(Long userId, AlertType alertType);
}
