package com.homeplatform.service;

import com.homeplatform.model.AppEvent;
import com.homeplatform.repository.AppEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class AppEventService {

    private static final Logger log = LoggerFactory.getLogger(AppEventService.class);
    /** Diagnostic events older than this are pruned nightly. */
    private static final int RETENTION_DAYS = 90;
    private final AppEventRepository repository;

    public AppEventService(AppEventRepository repository) {
        this.repository = repository;
    }

    /** Log a diagnostic event and persist it. Also writes to SLF4J for Docker log visibility. */
    public AppEvent log(String category, String level, String source, String message, String details) {
        AppEvent event = new AppEvent(category, level, source, message, details);

        // Mirror to SLF4J for container log visibility
        String logMsg = String.format("[%s][%s] %s: %s", category, level, source, message);
        switch (level.toUpperCase()) {
            case "ERROR" -> log.error(logMsg);
            case "WARN"  -> log.warn(logMsg);
            default      -> log.info(logMsg);
        }

        return repository.save(event);
    }

    /** Shorthand for INFO-level events. */
    public AppEvent info(String category, String source, String message) {
        return log(category, "INFO", source, message, null);
    }

    /** Shorthand for WARN-level events. */
    public AppEvent warn(String category, String source, String message) {
        return log(category, "WARN", source, message, null);
    }

    /** Shorthand for ERROR-level events. */
    public AppEvent error(String category, String source, String message, String details) {
        return log(category, "ERROR", source, message, details);
    }

    /** Get events from the last N hours, optionally filtered. */
    public List<AppEvent> getRecent(int hours, String category, String level) {
        LocalDateTime since = LocalDateTime.now().minusHours(hours);

        if (category != null && !category.isEmpty() && !category.equals("all")) {
            if (level != null && !level.isEmpty() && !level.equals("all")) {
                return repository.findRecentByCategoryAndLevel(since, category, level);
            }
            return repository.findRecentByCategory(since, category);
        }

        if (level != null && !level.isEmpty() && !level.equals("all")) {
            return repository.findRecentByLevel(since, level);
        }

        return repository.findRecent(since);
    }

    /** Clean up events older than N days. */
    public long cleanup(int days) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(days);
        return repository.deleteByTimestampBefore(cutoff);
    }

    /**
     * Nightly retention (3:30 AM CT) — prunes events older than {@link #RETENTION_DAYS}
     * so app_events doesn't grow unbounded. {@link #cleanup(int)} existed but nothing
     * ever scheduled it. Cron-gated, so it doesn't fire during short test runs.
     */
    @Scheduled(cron = "0 30 3 * * *", zone = "America/Chicago")
    public void scheduledCleanup() {
        long removed = cleanup(RETENTION_DAYS);
        if (removed > 0) {
            log.info("app_events retention: removed {} events older than {} days", removed, RETENTION_DAYS);
        }
    }
}
