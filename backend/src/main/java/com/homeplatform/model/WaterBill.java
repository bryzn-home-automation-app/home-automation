package com.homeplatform.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Itemized water bill (Water/Sewer/Refuse/Tax/Stormwater), parsed from the monthly
 * PDF forwarded to Gmail. Append-only, like {@link UtilityBill} — never updated
 * or deleted; a re-processed bill for the same period upserts via the unique
 * constraint on (account_id, billing_period_start, billing_period_end).
 */
@Entity
@Table(name = "water_bills")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WaterBill {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_id", nullable = false)
    private UtilityAccount account;

    @NotNull
    @Column(name = "billing_period_start", nullable = false)
    private LocalDate billingPeriodStart;

    @NotNull
    @Column(name = "billing_period_end", nullable = false)
    private LocalDate billingPeriodEnd;

    @Column(name = "billing_date")
    private LocalDate billingDate;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "usage_thousands", precision = 10, scale = 3)
    private BigDecimal usageThousands;

    @Column(name = "water_charge", precision = 10, scale = 2)
    private BigDecimal waterCharge;

    @Column(name = "sewer_charge", precision = 10, scale = 2)
    private BigDecimal sewerCharge;

    @Column(name = "refuse_charge", precision = 10, scale = 2)
    private BigDecimal refuseCharge;

    @Column(name = "tax_charge", precision = 10, scale = 2)
    private BigDecimal taxCharge;

    @Column(name = "stormwater_charge", precision = 10, scale = 2)
    private BigDecimal stormwaterCharge;

    /** Negative when present (e.g. ACH discount). Null on bills without one. */
    @Column(name = "ach_discount", precision = 10, scale = 2)
    private BigDecimal achDiscount;

    @NotNull
    @Column(name = "total_due", nullable = false, precision = 10, scale = 2)
    private BigDecimal totalDue;

    // --- Audit / traceability metadata ---

    @NotBlank
    @Column(nullable = false, length = 100)
    @Builder.Default
    private String source = "Gmail Water Bill PDF";

    @NotBlank
    @Column(name = "source_provider", nullable = false, length = 50)
    @Builder.Default
    private String sourceProvider = "gmail-water-bill";

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
