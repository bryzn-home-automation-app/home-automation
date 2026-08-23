package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * One published app version and its plain-language release notes, shown on the
 * "What's New" tab. Authored in code (see {@code ReleaseSeeder}) and upserted
 * into this table on startup; the history is the full set of rows.
 */
@Entity
@Table(name = "app_releases")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AppRelease {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Semantic version, e.g. "1.0.0". Unique — one row per version. */
    @Column(nullable = false, unique = true, length = 20)
    private String version;

    /** Release maturity: "beta" or "stable". */
    @Column(nullable = false, length = 20)
    private String stage;

    @Column(name = "released_at", nullable = false)
    private LocalDate releasedAt;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String summary;

    /** Ordered list of change line items, stored as a JSONB array. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<ReleaseChange> changes;

    /**
     * Explicit display order (higher = newer). Assigned by the seeder so ordering
     * never depends on string-comparing semantic versions (1.10.0 vs 1.9.0).
     */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
