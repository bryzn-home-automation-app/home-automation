package com.homeplatform.dto;

/**
 * One alert type and whether this member gets it: {@code inApp} in the Alerts list,
 * {@code push} on their phone too. The defaults let the UI show what "reset" means.
 */
public record NotificationPreferenceResponse(
        String type,
        String category,
        String label,
        String description,
        boolean inApp,
        boolean push,
        boolean defaultInApp,
        boolean defaultPush
) {}
