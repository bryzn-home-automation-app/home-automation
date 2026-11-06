package com.homeplatform.service;

import com.homeplatform.dto.NotificationPreferenceResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.NotificationPreference;
import com.homeplatform.repository.NotificationPreferenceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Which alert types each member receives, in the app and on their phone. */
@Service
public class NotificationPreferenceService {

    /** What a member gets for one type, after their choice (or the default). */
    public record Effective(boolean inApp, boolean push) {}

    private final NotificationPreferenceRepository repo;

    public NotificationPreferenceService(NotificationPreferenceRepository repo) {
        this.repo = repo;
    }

    public Effective effective(Long userId, AlertType type) {
        return repo.findByUserIdAndAlertType(userId, type)
                .map(p -> new Effective(p.isInApp(), p.isInApp() && p.isPush()))
                .orElseGet(() -> new Effective(type.defaultInApp(), type.defaultInApp() && type.defaultPush()));
    }

    /**
     * {@code users} who get {@code type}, in the same order: everyone but those who turned it
     * off, or for a type that's off by default (weather), only those who turned it on.
     */
    public List<Long> wanting(List<Long> users, AlertType type) {
        if (users.isEmpty()) return users;
        if (!type.defaultInApp()) {
            Set<Long> on = repo.findByAlertTypeAndInAppTrue(type).stream()
                    .map(NotificationPreference::getUserId)
                    .collect(Collectors.toSet());
            return users.stream().filter(on::contains).toList();
        }
        Set<Long> off = repo.findByAlertTypeAndInAppFalse(type).stream()
                .map(NotificationPreference::getUserId)
                .collect(Collectors.toSet());
        if (off.isEmpty()) return users;
        return users.stream().filter(u -> !off.contains(u)).toList();
    }

    /** Every type, in catalog order, with this member's settings. */
    public List<NotificationPreferenceResponse> list(Long userId) {
        Map<AlertType, NotificationPreference> mine = repo.findByUserId(userId).stream()
                .collect(Collectors.toMap(NotificationPreference::getAlertType, Function.identity(), (a, b) -> a));
        return Arrays.stream(AlertType.values()).map(t -> {
            NotificationPreference p = mine.get(t);
            boolean inApp = p != null ? p.isInApp() : t.defaultInApp();
            boolean push = inApp && (p != null ? p.isPush() : t.defaultPush());
            return new NotificationPreferenceResponse(t.name(), t.category().name(), t.label(), t.description(),
                    inApp, push, t.defaultInApp(), t.defaultPush());
        }).toList();
    }

    /** Set one type. Phone alerts need the alert itself, so {@code push} is dropped when {@code inApp} is off. */
    @Transactional
    public NotificationPreferenceResponse update(Long userId, AlertType type, boolean inApp, boolean push) {
        NotificationPreference p = repo.findByUserIdAndAlertType(userId, type)
                .orElseGet(() -> NotificationPreference.builder().userId(userId).alertType(type).build());
        p.setInApp(inApp);
        p.setPush(inApp && push);
        p.setUpdatedAt(LocalDateTime.now());
        repo.save(p);
        return list(userId).stream().filter(r -> r.type().equals(type.name())).findFirst().orElseThrow();
    }

    /**
     * Back to the defaults for every type on the Alert types card. Weather alerts have their
     * own card and settings, so they're left as they are.
     */
    @Transactional
    public List<NotificationPreferenceResponse> reset(Long userId) {
        repo.deleteAll(repo.findByUserId(userId).stream()
                .filter(p -> p.getAlertType().category() != Category.WEATHER)
                .toList());
        return list(userId);
    }
}
