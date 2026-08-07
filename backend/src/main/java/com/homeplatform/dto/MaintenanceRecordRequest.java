package com.homeplatform.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

public record MaintenanceRecordRequest(
        String title,
        String description,
        String category,
        String area,
        String priority,
        String status,
        LocalDate scheduledDate,
        LocalDate startedDate,
        LocalDate completedDate,
        String requestedBy,
        String completedBy,
        String contractorName,
        String company,
        String receiptNumber,
        BigDecimal cost,
        LocalDate warrantyExpiration,
        String photosBefore,
        String photosDuring,
        String photosAfter,
        String documents,
        String notes
) {}
