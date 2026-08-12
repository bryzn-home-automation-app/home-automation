package com.homeplatform.controller;

import com.homeplatform.dto.DailyUsagePoint;
import com.homeplatform.dto.UsageRangeSummaryResponse;
import com.homeplatform.model.EnergyUsage;
import com.homeplatform.service.EnergyUsageService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/energy-usage")
public class EnergyUsageController {

    private final EnergyUsageService service;

    public EnergyUsageController(EnergyUsageService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<EnergyUsage>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @GetMapping("/meter/{meterId}")
    public ResponseEntity<List<EnergyUsage>> getByMeter(@PathVariable Long meterId) {
        return ResponseEntity.ok(service.getByMeterId(meterId));
    }

    @GetMapping("/meter/{meterId}/range")
    public ResponseEntity<List<EnergyUsage>> getByMeterAndRange(
            @PathVariable Long meterId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end) {
        return ResponseEntity.ok(service.getByMeterAndDateRange(meterId, start, end));
    }

    @GetMapping("/meter/{meterId}/summary")
    public ResponseEntity<UsageRangeSummaryResponse> getSummary(
            @PathVariable Long meterId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end) {
        return ResponseEntity.ok(service.getSummary(meterId, start, end));
    }

    @GetMapping("/meter/{meterId}/recent")
    public ResponseEntity<List<EnergyUsage>> getRecent(
            @PathVariable Long meterId,
            @RequestParam(defaultValue = "30") int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        return ResponseEntity.ok(service.getRecent(meterId, since));
    }

    @GetMapping("/meter/{meterId}/total")
    public ResponseEntity<Map<String, Object>> getTotalUsage(
            @PathVariable Long meterId,
            @RequestParam(defaultValue = "30") int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        Double totalKwh = service.getTotalUsageSince(meterId, since);
        return ResponseEntity.ok(Map.of(
                "meterId", meterId,
                "days", days,
                "totalKwh", totalKwh
        ));
    }

    /** Pre-aggregated daily kWh from hourly records — ~60 rows instead of 1,440. */
    @GetMapping("/meter/{meterId}/daily")
    public ResponseEntity<List<DailyUsagePoint>> getDaily(
            @PathVariable Long meterId,
            @RequestParam(defaultValue = "60") int days) {
        return ResponseEntity.ok(service.getDailyAggregates(meterId, days));
    }

    /**
     * Batch summary — one HTTP call for N date ranges instead of N calls.
     * Accepts a comma-separated list: ?periods=start1,end1;start2,end2;...
     */
    @GetMapping("/meter/{meterId}/summaries")
    public ResponseEntity<List<UsageRangeSummaryResponse>> getBatchSummaries(
            @PathVariable Long meterId,
            @RequestParam String periods) {
        var periodList = new java.util.ArrayList<LocalDateTime[]>();
        for (String pair : periods.split(";")) {
            String[] parts = pair.split(",");
            if (parts.length == 2) {
                periodList.add(new LocalDateTime[]{
                        LocalDateTime.parse(parts[0]),
                        LocalDateTime.parse(parts[1])
                });
            }
        }
        return ResponseEntity.ok(service.getBatchSummaries(meterId, periodList));
    }
}
