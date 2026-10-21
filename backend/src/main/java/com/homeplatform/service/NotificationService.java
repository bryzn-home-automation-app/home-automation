package com.homeplatform.service;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.push.NotificationCreatedEvent;
import com.homeplatform.repository.NotificationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);
    private static final int DEFAULT_LIMIT = 50;

    private final NotificationRepository repo;
    /** Phone alerts listen for this (PushService); null in plain unit tests. */
    private final ApplicationEventPublisher events;
    /** Each member's alert-type choices; null in plain unit tests (everyone gets the defaults). */
    private final NotificationPreferenceService preferences;

    @Autowired
    public NotificationService(NotificationRepository repo, ApplicationEventPublisher events,
                               NotificationPreferenceService preferences) {
        this.repo = repo;
        this.events = events;
        this.preferences = preferences;
    }

    public NotificationService(NotificationRepository repo) {
        this(repo, null, null);
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
    /** Marks one of the user's own notifications read; someone else's id is a no-op (0). */
    public int markRead(Long id, Long userId) {
        return repo.markRead(id, userId);
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
        Notification saved = repo.save(n);
        if (events != null) events.publishEvent(new NotificationCreatedEvent(userId, category, severity, title, message));
        return saved;
    }

    /**
     * An alert of a known type, honoring the member's settings: not created at all when
     * they turned the type off, and pushed to their phone only when they chose that.
     * Returns null when skipped.
     */
    @Transactional
    public Notification send(Long userId, AlertType type, Severity severity, String title, String message) {
        NotificationPreferenceService.Effective pref = preferences != null
                ? preferences.effective(userId, type)
                : new NotificationPreferenceService.Effective(type.defaultInApp(), type.defaultInApp() && type.defaultPush());
        if (!pref.inApp()) {
            log.debug("Alert {} skipped for user {} (turned off)", type, userId);
            return null;
        }
        Notification saved = repo.save(Notification.builder()
                .userId(userId)
                .category(type.category())
                .severity(severity)
                .title(title)
                .message(message)
                .build());
        if (events != null) {
            events.publishEvent(new NotificationCreatedEvent(userId, type.category(), severity, title, message, pref.push()));
        }
        return saved;
    }

    /** {@code users} minus those who turned {@code type} off, so callers can skip work nobody wants. */
    public List<Long> wanting(List<Long> users, AlertType type) {
        return preferences == null ? users : preferences.wanting(users, type);
    }

}
