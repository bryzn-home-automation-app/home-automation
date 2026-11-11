package com.homeplatform.push;

import com.homeplatform.model.Notification;

/** Published by NotificationService for every in-app notification; PushService decides what to push. */
public record NotificationCreatedEvent(
        Long userId,
        Notification.Category category,
        Notification.Severity severity,
        String title,
        String message,
        /** The member's phone-alert choice for this alert's type; null = the built-in rule. */
        Boolean push,
        /** The page a tap on the phone alert opens; null = the category's page. */
        String url
) {
    public NotificationCreatedEvent(Long userId, Notification.Category category, Notification.Severity severity,
                                    String title, String message) {
        this(userId, category, severity, title, message, null, null);
    }

    public NotificationCreatedEvent(Long userId, Notification.Category category, Notification.Severity severity,
                                    String title, String message, Boolean push) {
        this(userId, category, severity, title, message, push, null);
    }
}
