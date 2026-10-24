package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/** One member opening a tab, or one minute active on it. Append-only. */
@Entity
@Table(name = "tab_activity", indexes = @Index(name = "idx_tab_activity_at", columnList = "at"))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TabActivity {

    public enum Kind { VIEW, ACTIVE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** The tab's path without the leading slash: "home", "cameras", "admin/debug". */
    @Column(nullable = false, length = 40)
    private String tab;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Kind kind;

    /** UTC. */
    @Column(nullable = false)
    @Builder.Default
    private LocalDateTime at = LocalDateTime.now(java.time.ZoneOffset.UTC);
}
