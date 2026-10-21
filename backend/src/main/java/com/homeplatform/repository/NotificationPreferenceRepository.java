package com.homeplatform.repository;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.NotificationPreference;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface NotificationPreferenceRepository extends JpaRepository<NotificationPreference, Long> {

    List<NotificationPreference> findByUserId(Long userId);

    Optional<NotificationPreference> findByUserIdAndAlertType(Long userId, AlertType alertType);

    /** Everyone who turned this type off — one query for a whole recipient list. */
    List<NotificationPreference> findByAlertTypeAndInAppFalse(AlertType alertType);
}
