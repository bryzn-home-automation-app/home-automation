package com.homeplatform.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GuestLoginRequest(
        @NotBlank @Size(min = 2, max = 100) String displayName,
        String accentColor,
        String avatarUrl,
        String ipAddress,
        String userAgent
) {}
