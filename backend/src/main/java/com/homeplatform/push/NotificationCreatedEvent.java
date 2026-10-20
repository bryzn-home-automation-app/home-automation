package com.homeplatform.push;

import com.homeplatform.model.Notification;

/** Published by NotificationService for every in-app notification; PushService decides what to push. */
public record NotificationCreatedEvent(
        Long userId,
        Notification.Category category,
        Notification.Severity severity,
        String title,
        String message
) {}
