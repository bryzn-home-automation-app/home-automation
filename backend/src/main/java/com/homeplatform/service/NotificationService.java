package com.homeplatform.service;

import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.repository.NotificationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);
    private static final int DEFAULT_LIMIT = 50;

    private final NotificationRepository repo;

    public NotificationService(NotificationRepository repo) {
        this.repo = repo;
    }

    // ── Query ──

    public List<Notification> getNotifications(Long userId, String category, String severity,
                                                boolean unreadOnly, int limit) {
        int size = limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT;
        var pageable = PageRequest.of(0, size);

        if (unreadOnly) {
            return repo.findByUserIdAndIsReadFalseOrderByCreatedAtDesc(userId, pageable);
        }
        if (category != null && severity != null) {
            return repo.findByUserIdAndCategoryAndSeverityOrderByCreatedAtDesc(
                    userId, Category.valueOf(category.toUpperCase()),
                    Severity.valueOf(severity.toUpperCase()), pageable);
        }
        if (category != null) {
            return repo.findByUserIdAndCategoryOrderByCreatedAtDesc(
                    userId, Category.valueOf(category.toUpperCase()), pageable);
        }
        if (severity != null) {
            return repo.findByUserIdAndSeverityOrderByCreatedAtDesc(
                    userId, Severity.valueOf(severity.toUpperCase()), pageable);
        }
        return repo.findByUserIdOrderByCreatedAtDesc(userId, pageable);
    }

    public long getUnreadCount(Long userId) {
        return repo.countByUserIdAndIsReadFalse(userId);
    }

    @Transactional
    public int markRead(Long id) {
        return repo.markRead(id);
    }

    @Transactional
    public int markAllRead(Long userId) {
        int count = repo.markAllRead(userId);
        log.info("Marked {} notifications read for user {}", count, userId);
        return count;
    }

    // ── Create ──

    @Transactional
    public Notification create(Long userId, Category category, Severity severity, String title, String message) {
        Notification n = Notification.builder()
                .userId(userId)
                .category(category)
                .severity(severity)
                .title(title)
                .message(message)
                .build();
        return repo.save(n);
    }

}
