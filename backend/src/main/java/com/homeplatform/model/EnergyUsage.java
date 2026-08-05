package com.homeplatform.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "energy_usage")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnergyUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "meter_id", nullable = false)
    private Meter meter;

    @NotNull
    @Column(nullable = false)
    private LocalDateTime timestamp;

    @NotNull
    @Column(name = "usage_kwh", nullable = false, precision = 10, scale = 3)
    private BigDecimal usageKwh;

    @Column(precision = 10, scale = 2)
    private BigDecimal cost;

    @NotBlank
    @Column(nullable = false, length = 100)
    private String source;

    @Column(name = "raw_file", length = 500)
    private String rawFile;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
