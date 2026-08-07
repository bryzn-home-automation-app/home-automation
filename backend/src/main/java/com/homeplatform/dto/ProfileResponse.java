package com.homeplatform.dto;

public record ProfileResponse(
        Long id,
        String username,
        String email,
        String displayName,
        String phone,
        String avatarUrl,
        String accentColor,
        String role,
        String status
) {}
