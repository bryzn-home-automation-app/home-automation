package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * A device the NUC has seen on the home Wi-Fi (scripts/presence-scan.ps1), keyed by MAC.
 * An admin labels it and says whose it is; that person counts as home while it's seen.
 * Times are UTC.
 */
@Entity
@Table(name = "network_devices")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NetworkDevice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Lowercase, colon-separated: "d0:68:27:d2:cc:d2". */
    @Column(nullable = false, unique = true, length = 17)
    private String mac;

    /** Last IP it answered on (DHCP can move it). */
    @Column(length = 15)
    private String ip;

    /** What it is: "Bryan's iPhone". */
    @Column(length = 60)
    private String label;

    /** Whose it is: "Bryan". Blank = it doesn't count toward anyone being home. */
    @Column(length = 40)
    private String person;

    @Column(name = "first_seen", nullable = false)
    private LocalDateTime firstSeen;

    @Column(name = "last_seen", nullable = false)
    private LocalDateTime lastSeen;

    /** Start of the current stretch on the network: the first scan after it was away. */
    @Column(name = "present_since", nullable = false)
    private LocalDateTime presentSince;
}
