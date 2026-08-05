package com.homeplatform.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean dbConnected;
        try (Connection conn = dataSource.getConnection()) {
            dbConnected = conn.isValid(3);
        } catch (Exception e) {
            dbConnected = false;
        }

        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "database", dbConnected ? "connected" : "disconnected",
                "timestamp", java.time.Instant.now().toString()
        ));
    }
}
