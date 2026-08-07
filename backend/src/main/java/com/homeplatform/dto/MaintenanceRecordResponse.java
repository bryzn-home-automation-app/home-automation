package com.homeplatform.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

public record MaintenanceRecordResponse(
        Long id,
        String title,
        String description,
        String category,
        String area,
        String priority,
        String status,
        LocalDate scheduledDate,
        LocalDate startedDate,
        LocalDate completedDate,
        BigDecimal cost,
        String requestedBy,
        String completedBy,
        String contractorName,
        String company,
        String receiptNumber,
        LocalDate warrantyExpiration,
        String photosBefore,
        String photosDuring,
        String photosAfter,
        String documents,
        String notes,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {}
