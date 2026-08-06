package com.homeplatform.dto;

public record LoginResponse(
        String token,
        Long userId,
        String username,
        String displayName,
        String role
) {}
