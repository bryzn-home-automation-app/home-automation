package com.homeplatform.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

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

    @Column(name = "raw_file", length = 500)
    private String rawFile;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
