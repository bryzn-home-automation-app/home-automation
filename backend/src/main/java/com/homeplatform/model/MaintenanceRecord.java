package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "maintenance_records")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MaintenanceRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    // ── Basic info ──
    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(nullable = false, length = 50)
    private String category;

    @Column(length = 50)
    private String area;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Priority priority = Priority.MEDIUM;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Status status = Status.SCHEDULED;

    // ── Dates ──
    @Column(name = "scheduled_date")
    private LocalDate scheduledDate;

    @Column(name = "started_date")
    private LocalDate startedDate;

    @Column(name = "completed_date")
    private LocalDate completedDate;

    // ── Cost ──
    @Column(precision = 12, scale = 2)
    private BigDecimal cost;

    // ── People ──
    @Column(name = "requested_by", length = 200)
    private String requestedBy;

    @Column(name = "completed_by", length = 200)
    private String completedBy;

    // ── Contractor ──
    @Column(name = "contractor_name", length = 200)
    private String contractorName;

    @Column(length = 200)
    private String company;

    @Column(name = "receipt_number", length = 100)
    private String receiptNumber;

    @Column(name = "warranty_expiration")
    private LocalDate warrantyExpiration;

    // ── Photos (JSON array of URLs) ──
    @Column(name = "photos_before", columnDefinition = "TEXT")
    private String photosBefore;

    @Column(name = "photos_during", columnDefinition = "TEXT")
    private String photosDuring;

    @Column(name = "photos_after", columnDefinition = "TEXT")
    private String photosAfter;

    // ── Documents (JSON array of URLs) ──
    @Column(columnDefinition = "TEXT")
    private String documents;

    // ── Notes ──
    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();

    public enum Priority {
        LOW, MEDIUM, HIGH, EMERGENCY
    }

    public enum Status {
        SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
