package com.homeplatform.repository;

import com.homeplatform.model.Notification;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Repository
public interface NotificationRepository extends JpaRepository<Notification, Long> {

    List<Notification> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    List<Notification> findByUserIdAndCategoryOrderByCreatedAtDesc(Long userId, Notification.Category category, Pageable pageable);

    List<Notification> findByUserIdAndSeverityOrderByCreatedAtDesc(Long userId, Notification.Severity severity, Pageable pageable);

    List<Notification> findByUserIdAndIsReadFalseOrderByCreatedAtDesc(Long userId, Pageable pageable);

    List<Notification> findByUserIdAndCategoryAndSeverityOrderByCreatedAtDesc(
            Long userId, Notification.Category category, Notification.Severity severity, Pageable pageable);

    long countByUserIdAndIsReadFalse(Long userId);

    @Modifying
    @Transactional
    @Query("UPDATE Notification n SET n.isRead = true WHERE n.userId = :userId AND n.isRead = false")
    int markAllRead(Long userId);

    @Modifying
    @Transactional
    @Query("UPDATE Notification n SET n.isRead = true WHERE n.id = :id")
    int markRead(Long id);
}
