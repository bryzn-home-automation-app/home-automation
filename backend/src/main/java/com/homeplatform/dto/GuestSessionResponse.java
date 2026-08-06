package com.homeplatform.dto;

import java.time.LocalDateTime;

public record GuestSessionResponse(
        Long id,
        Long userId,
        String guestName,
        String ipAddress,
        String userAgent,
        LocalDateTime connectedAt,
        LocalDateTime lastSeenAt,
        LocalDateTime expiresAt,
        String status,
        int connectionCount
) {}
