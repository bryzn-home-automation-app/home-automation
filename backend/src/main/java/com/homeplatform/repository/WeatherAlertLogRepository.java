package com.homeplatform.repository;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.WeatherAlertLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;

@Repository
public interface WeatherAlertLogRepository extends JpaRepository<WeatherAlertLog, Long> {

    boolean existsByUserIdAndAlertTypeAndAlertKey(Long userId, AlertType alertType, String alertKey);

    /** Whether any of these keys was logged: an updated warning names the ones it replaces. */
    boolean existsByUserIdAndAlertTypeAndAlertKeyIn(Long userId, AlertType alertType, Collection<String> alertKeys);

    @Modifying
    @Transactional
    @Query("DELETE FROM WeatherAlertLog l WHERE l.createdAt < :cutoff")
    int deleteByCreatedAtBefore(@Param("cutoff") LocalDateTime cutoff);
}
