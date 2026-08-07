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

import java.time.LocalDateTime;
import java.util.*;

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

    // ── Seed sample data ──

    @Transactional
    public void seedSampleNotifications(Long userId) {
        if (repo.countByUserIdAndIsReadFalse(userId) > 0) return;

        var now = LocalDateTime.now();

        record S(Category cat, Severity sev, String title, String msg, int minsAgo) {}
        var samples = List.of(
            // Electrical
            new S(Category.ELECTRICAL, Severity.INFO,    "Daily usage report available", "Your electric usage for Aug 5 is 31.1 kWh. View the full breakdown.", 5),
            new S(Category.ELECTRICAL, Severity.SUCCESS, "Utility data synchronized", "CoServ sync completed: 1 electric reading written for Aug 5.", 45),
            new S(Category.ELECTRICAL, Severity.WARNING, "Usage exceeds daily average", "Today's usage is 22% above your 30-day average of 25.5 kWh.", 60),
            new S(Category.ELECTRICAL, Severity.INFO,    "Monthly bill estimate updated", "Estimated bill: $87.42 based on 747 kWh at $0.1171/kWh.", 180),
            new S(Category.ELECTRICAL, Severity.WARNING, "Peak usage hour detected", "Highest consumption between 4:00–5:00 PM at 3.2 kWh.", 360),
            new S(Category.ELECTRICAL, Severity.CRITICAL,"Utility data sync failed", "CoServ login failed. Check credentials and run test:live.", 1440),
            // Gas
            new S(Category.GAS,    Severity.INFO,    "Daily gas usage updated", "No gas usage recorded for Aug 5 (summer low-usage period).", 30),
            new S(Category.GAS,    Severity.SUCCESS, "Gas utility data synchronized", "CoServ gas sync completed successfully.", 1440),
            // Water
            new S(Category.WATER,  Severity.INFO,    "Daily water usage updated", "Estimated 142 gallons used today. Slightly above weekday average.", 10),
            new S(Category.WATER,  Severity.WARNING, "Unusually high water consumption", "Yesterday's usage was 320 gallons — 2.3× your daily average.", 1440),
            // Roomba
            new S(Category.ROOMBA, Severity.SUCCESS, "Cleaning completed", "Roomba finished living room + kitchen in 58 minutes. 6 dirt events detected.", 20),
            new S(Category.ROOMBA, Severity.INFO,    "Cleaning started", "Scheduled daily clean began at 10:00 AM.", 300),
            new S(Category.ROOMBA, Severity.WARNING, "Robot is stuck", "Roomba stopped under the dining table. Manual intervention needed.", 2880),
            // WiFi
            new S(Category.WIFI,   Severity.INFO,    "Guest connected", "Sarah joined the guest network from 192.168.1.142 (iPhone).", 15),
            new S(Category.WIFI,   Severity.SUCCESS, "Speed test completed", "Download: 287 Mbps • Upload: 23 Mbps • Latency: 12ms.", 120),
            new S(Category.WIFI,   Severity.WARNING, "High network latency detected", "Latency spiked to 340ms at 7:42 AM. Check router.", 480),
            new S(Category.WIFI,   Severity.CRITICAL,"Internet connection lost", "Connection dropped at 2:15 AM for 8 minutes. Router rebooted.", 1440),
            new S(Category.WIFI,   Severity.INFO,    "Unknown device joined network", "Device 'Samsung-TV-Living' (MAC: aa:bb:cc:11:22:33) connected.", 1440)
        );

        for (var s : samples) {
            Notification n = Notification.builder()
                    .userId(userId)
                    .category(s.cat)
                    .severity(s.sev)
                    .title(s.title)
                    .message(s.msg)
                    .createdAt(now.minusMinutes(s.minsAgo))
                    .build();
            repo.save(n);
        }
        log.info("Seeded {} sample notifications for user {}", samples.size(), userId);
    }
}
