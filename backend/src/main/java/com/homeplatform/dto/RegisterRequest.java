package com.homeplatform.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Email String email,
        @NotBlank @Size(min = 3, max = 50) String username,
        @NotBlank @Size(min = 6) String password,
        @Size(max = 200) String displayName
) {}
