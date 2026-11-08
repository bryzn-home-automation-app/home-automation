package com.homeplatform.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonRawValue;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Combined electric+gas CoServ bill, downloaded as a PDF from SmartHub Billing
 * History. CoServ issues one statement per billing cycle covering both services,
 * so this is one row per bill with both electric_* and gas_* columns, itemized at
 * the same category-total granularity as {@link WaterBill}, plus the gas section's
 * charge lines ({@link #gasLineItems}). Append-only — never updated
 * or deleted; a re-processed bill for the same period upserts via the unique
 * constraint on (account_id, billing_period_start, billing_period_end).
 */
@Entity
@Table(name = "coserv_bills", uniqueConstraints = @UniqueConstraint(
        columnNames = {"account_id", "billing_period_start", "billing_period_end"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CoservBill {

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

    @Column(name = "electric_usage_kwh", precision = 10, scale = 2)
    private BigDecimal electricUsageKwh;

    @Column(name = "electric_charge", precision = 10, scale = 2)
    private BigDecimal electricCharge;

    @Column(name = "gas_usage_ccf", precision = 10, scale = 2)
    private BigDecimal gasUsageCcf;

    @Column(name = "gas_charge", precision = 10, scale = 2)
    private BigDecimal gasCharge;

    /**
     * The gas section's charge lines as a JSON array written by
     * {@code scripts/coserv-bill-parser.js}: {@code [{label, amount, kind, ccf?, rate?}]},
     * kind being usage (per CCF), taxes or fixed. Sent to the client as an array.
     * Null for bills parsed before it existed, or whose lines didn't add up to the gas charge.
     */
    @JsonRawValue
    @Column(name = "gas_line_items", columnDefinition = "TEXT")
    private String gasLineItems;

    @Column(name = "current_charges", precision = 10, scale = 2)
    private BigDecimal currentCharges;

    @NotNull
    @Column(name = "total_due", nullable = false, precision = 10, scale = 2)
    private BigDecimal totalDue;

    /** Relative path under the uploads static handler, e.g. "bills/9002001851_2026-09-08.pdf". */
    @Column(name = "pdf_path", length = 500)
    private String pdfPath;

    // --- Audit / traceability metadata ---

    @NotBlank
    @Column(nullable = false, length = 100)
    @Builder.Default
    private String source = "CoServ SmartHub PDF";

    @NotBlank
    @Column(name = "source_provider", nullable = false, length = 50)
    @Builder.Default
    private String sourceProvider = "coserv-smarthub-bill";

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
