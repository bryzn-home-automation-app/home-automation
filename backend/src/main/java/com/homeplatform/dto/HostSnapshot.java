package com.homeplatform.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * One sample from scripts/host-metrics.ps1, as it writes host-metrics/metrics.json (and as
 * the NUC Health page receives it). Any section can be null when the NUC couldn't read it;
 * {@code agent.errors} says why. Rates are per second, averaged since the previous sample.
 * Lists accept a lone object too: PowerShell can write a one-item list that way. Fields the
 * backend doesn't know yet are ignored, so a newer monitor script never breaks an older backend.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record HostSnapshot(
        Instant collectedAt,
        Double intervalSeconds,
        Host host,
        Cpu cpu,
        Memory memory,
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<Disk> disks,
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<PhysicalDisk> physicalDisks,
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<Temperature> temperatures,
        Network network,
        Power power,
        /** Restarts, shutdowns and sleep in the last 30 days, newest first. */
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<PowerEvent> events,
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<Proc> topCpu,
        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<Proc> topMemory,
        Docker docker,
        Agent agent) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Host(String name, String model, String os, String osBuild, String cpuModel,
                       Integer cores, Integer logicalProcessors, Instant bootTime) {}

    /** {@code usagePct}: share of all CPUs, 0–100; null on the monitor's first run. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Cpu(Double usagePct, Integer clockMhz, Integer maxClockMhz) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Memory(Long totalBytes, Long availableBytes, Long commitBytes, Long commitLimitBytes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Disk(String name, String label, Long totalBytes, Long freeBytes, Double readBps, Double writeBps) {}

    /** {@code health}: Windows' verdict ("Healthy", "Warning", "Unhealthy"); {@code wearPct}: 0 = new. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PhysicalDisk(String name, String mediaType, Long sizeBytes, String health,
                               Double temperatureC, Double wearPct, Long powerOnHours) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Temperature(String name, Double celsius) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Network(String adapter, String description, Double linkMbps, String ip,
                          Double rxBps, Double txBps, Wifi wifi, Boolean tailscaleUp) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Wifi(String ssid, Double signalPct, Double rssi, String band, String channel,
                       String radio, Double rxMbps, Double txMbps) {}

    /** {@code sleepAfterMinutes}: 0 = never sleeps (as a server should). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Power(String plan, Integer sleepAfterMinutes, Boolean pendingReboot) {}

    /** {@code kind}: unexpected (froze or lost power), restart, shutdown, boot, sleep or wake. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PowerEvent(Instant at, Integer id, String kind, String message) {}

    /** Processes grouped by name; {@code cpuPct} is the share of the whole machine. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Proc(String name, Integer count, Double cpuPct, Long memBytes) {}

    /** {@code ok} false: Docker didn't answer, and {@code error} says how. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Docker(Boolean ok, String error, String version, Integer cpus, Long memTotalBytes,
                         @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<Container> containers) {}

    /** {@code cpuPct}: share of Docker's CPUs; usage is null for a container that isn't running. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Container(String name, String project, String image, String state, String status,
                            String health, Double cpuPct, Long memBytes, Long memLimitBytes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Agent(Integer version, Long durationMs, Map<String, Long> sectionMs,
                        @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY) List<String> errors) {}
}
