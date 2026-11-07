package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * One minute of the NUC's health (scripts/host-metrics.ps1): the headline numbers the NUC
 * Health charts draw, one row per sample. The full sample (containers, processes, power
 * events) is only kept for the latest one, in memory. Times are UTC; rates are averages
 * over the minute before {@code collectedAt}.
 */
@Entity
@Table(name = "host_metrics")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HostMetricSample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "collected_at", nullable = false, unique = true)
    private LocalDateTime collectedAt;

    /** Share of all CPUs busy, 0–100. Null on the first sample after the monitor starts. */
    @Column(name = "cpu_pct")
    private Double cpuPct;

    @Column(name = "mem_total_bytes")
    private Long memTotalBytes;

    @Column(name = "mem_used_bytes")
    private Long memUsedBytes;

    /** The system drive (C:). */
    @Column(name = "disk_total_bytes")
    private Long diskTotalBytes;

    @Column(name = "disk_free_bytes")
    private Long diskFreeBytes;

    /** The home-network adapter, bytes per second. */
    @Column(name = "net_rx_bps")
    private Double netRxBps;

    @Column(name = "net_tx_bps")
    private Double netTxBps;

    /** The hottest ACPI thermal zone. */
    @Column(name = "cpu_temp_c")
    private Double cpuTempC;

    /** The hottest drive (its own sensor). */
    @Column(name = "disk_temp_c")
    private Double diskTempC;

    /** All running containers together; null when Docker didn't answer. */
    @Column(name = "containers_mem_bytes")
    private Long containersMemBytes;

    /** When Windows last started; a later one than the previous sample's means it restarted. */
    @Column(name = "boot_time")
    private LocalDateTime bootTime;
}
