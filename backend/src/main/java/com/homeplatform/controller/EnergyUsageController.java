package com.homeplatform.controller;

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
}
