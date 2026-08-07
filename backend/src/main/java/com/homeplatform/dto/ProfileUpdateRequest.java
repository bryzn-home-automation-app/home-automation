package com.homeplatform.dto;

public record ProfileUpdateRequest(
        String displayName,
        String phone,
        String avatarUrl,
        String accentColor
) {}
