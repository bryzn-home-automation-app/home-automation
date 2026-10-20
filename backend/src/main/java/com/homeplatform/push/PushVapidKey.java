package com.homeplatform.push;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/** The server's VAPID key pair, base64url (public: uncompressed point; private: PKCS#8). */
@Entity
@Table(name = "push_vapid_keys")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PushVapidKey {

    @Id
    private Integer id;

    @Column(name = "public_key", nullable = false, length = 200)
    private String publicKey;

    @Column(name = "private_key", nullable = false, length = 400)
    private String privateKey;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
