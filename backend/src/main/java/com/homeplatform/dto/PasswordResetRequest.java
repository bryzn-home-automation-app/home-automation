package com.homeplatform.dto;

/**
 * POST /api/auth/reset-password. {@code birthDate} is ISO yyyy-MM-dd, parsed by the controller so a
 * malformed date is a plain 400 rather than a framework error.
 */
public record PasswordResetRequest(
        String username,
        String birthDate,
        String newPassword
) {}
