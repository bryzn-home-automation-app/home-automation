package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "notifications")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private Category category;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Severity severity = Severity.INFO;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 1000)
    private String message;

    @Column(name = "is_read", nullable = false)
    @Builder.Default
    private Boolean isRead = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    public enum Category {
        ELECTRICAL,
        GAS,
        WATER,
        ROOMBA,
        WIFI
    }

    public enum Severity {
        CRITICAL,
        WARNING,
        INFO,
        SUCCESS
    }
}
