package com.homeplatform.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Append-only bill record. Never updated or deleted.
 * A new statement for the same period creates a new row.
 */
@Entity
@Table(name = "utility_bills")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UtilityBill {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_id", nullable = false)
    private UtilityAccount account;

    @NotNull
    @Column(name = "billing_period_start", nullable = false)
    private LocalDate billingPeriodStart;

    @NotNull
    @Column(name = "billing_period_end", nullable = false)
    private LocalDate billingPeriodEnd;

    @Column(name = "usage_kwh", precision = 10, scale = 3)
    private BigDecimal usageKwh;

    @NotNull
    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal amount;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @NotBlank
    @Column(nullable = false, length = 50)
    @Builder.Default
    private String status = "ISSUED";

    // --- Audit / traceability metadata ---

    @NotBlank
    @Column(nullable = false, length = 100)
    @Builder.Default
    private String source = "CoServ API";

    @NotBlank
    @Column(name = "source_provider", nullable = false, length = 50)
    @Builder.Default
    private String sourceProvider = "coserv";

    @NotNull
    @Column(name = "ingestion_batch_id", nullable = false)
    private UUID ingestionBatchId;

    @NotBlank
    @Column(name = "processing_version", nullable = false, length = 20)
    @Builder.Default
    private String processingVersion = "1.0";

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
