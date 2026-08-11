package com.homeplatform.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ConfigController {

    @Value("${app.kwh-rate:0.12}")
    private double kwhRate;

    @Value("${app.data-start-date:07/24/2026}")
    private String dataStartDate;

    @Value("${app.property-latitude:0}")
    private double propertyLatitude;

    @Value("${app.property-longitude:0}")
    private double propertyLongitude;

    private final DataSource dataSource;

    public ConfigController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getConfig() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("kwhRate", kwhRate);
        config.put("dataStartDate", dataStartDate);
        config.put("propertyLatitude", propertyLatitude);
        config.put("propertyLongitude", propertyLongitude);

        // Git commit hash — env var (runtime) > committed file > build-time file
        String commit = System.getenv().getOrDefault("GIT_COMMIT", "");
        if (commit.isBlank()) {
            try {
                commit = Files.readString(Path.of("/app/.git-commit")).trim();
            } catch (IOException e) {}
        }
        if (commit.isBlank()) {
            try {
                commit = Files.readString(Path.of("/app/git-commit.txt")).trim();
            } catch (IOException e) {}
        }
        config.put("version", commit.isBlank() ? "unknown" : commit);

        // Most recent electric reading timestamp
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                 "SELECT MAX(timestamp) FROM hourly_electric_usage WHERE timestamp::date < CURRENT_DATE")) {
            var rs = stmt.executeQuery();
            if (rs.next()) {
                Timestamp ts = rs.getTimestamp(1);
                config.put("lastElectricReading", ts != null ? ts.toString() : null);
            }
        } catch (Exception ignored) {}

        // Most recent hourly sync check
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                 "SELECT MAX(timestamp) FROM app_events WHERE category = 'sync' AND source = 'HourlySyncScheduler'")) {
            var rs = stmt.executeQuery();
            if (rs.next()) {
                Timestamp ts = rs.getTimestamp(1);
                config.put("lastSyncCheck", ts != null ? ts.toString() : null);
            }
        } catch (Exception ignored) {}

        return ResponseEntity.ok(config);
    }
}
