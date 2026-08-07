package com.homeplatform.dto;

import java.time.LocalDateTime;

public record AdminUserResponse(
        Long id,
        String email,
        String username,
        String displayName,
        String role,
        String status,
        LocalDateTime lastLoginAt,
        int loginCount,
        LocalDateTime createdAt,
        LocalDateTime approvedAt,
        boolean isOnline,
        String avatarUrl,
        String accentColor
) {}
