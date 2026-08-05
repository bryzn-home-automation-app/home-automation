package com.homeplatform.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class ConfigController {

    @Value("${app.kwh-rate:0.12}")
    private double kwhRate;

    @Value("${app.data-start-date:07/24/2026}")
    private String dataStartDate;

    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getConfig() {
        return ResponseEntity.ok(Map.of(
                "kwhRate", kwhRate,
                "dataStartDate", dataStartDate
        ));
    }
}
