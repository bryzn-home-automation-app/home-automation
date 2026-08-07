package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(nullable = false, unique = true, length = 100)
    private String username;

    @Column(name = "display_name", length = 200)
    private String displayName;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private Role role = Role.USER;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private AccountStatus status = AccountStatus.PENDING_APPROVAL;

    @Column(name = "approved_by")
    private Long approvedBy;

    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    @Column(name = "last_login_at")
    private LocalDateTime lastLoginAt;

    @Column(name = "login_count", nullable = false)
    @Builder.Default
    private Integer loginCount = 0;

    @Column(name = "connection_count", nullable = false)
    @Builder.Default
    private Integer connectionCount = 0;

    @Column(length = 30)
    private String phone;

    @Column(name = "avatar_url", length = 500)
    private String avatarUrl;

    @Column(name = "accent_color", length = 7)
    @Builder.Default
    private String accentColor = "#34d399";

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();

    public enum Role {
        ADMIN,
        USER,
        GUEST
    }

    public enum AccountStatus {
        PENDING_APPROVAL,
        ACTIVE,
        DISABLED,
        EXPIRED
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
