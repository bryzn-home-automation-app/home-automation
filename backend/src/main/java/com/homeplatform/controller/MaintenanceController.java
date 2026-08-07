package com.homeplatform.controller;

import com.homeplatform.dto.*;
import com.homeplatform.service.MaintenanceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;

@RestController
@RequestMapping("/api/maintenance")
public class MaintenanceController {

    private final MaintenanceService service;
    private static final Path UPLOAD_DIR = Path.of(System.getProperty("user.dir", "."), "uploads", "maintenance");

    public MaintenanceController(MaintenanceService service) {
        this.service = service;
    }

    private Long userId(HttpServletRequest req) {
        return (Long) req.getAttribute("userId");
    }

    @GetMapping
    public ResponseEntity<List<MaintenanceRecordResponse>> list(
            HttpServletRequest req,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String area,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String priority,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Integer year,
            @RequestParam(defaultValue = "100") int limit) {
        return ResponseEntity.ok(service.list(userId(req), category, area, status, priority, search, year, limit));
    }

    @PostMapping
    public ResponseEntity<MaintenanceRecordResponse> create(
            @RequestBody MaintenanceRecordRequest body, HttpServletRequest req) {
        return ResponseEntity.ok(service.create(userId(req), body));
    }

    @GetMapping("/{id}")
    public ResponseEntity<MaintenanceRecordResponse> getById(
            @PathVariable Long id, HttpServletRequest req) {
        return ResponseEntity.ok(service.getById(id, userId(req)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<MaintenanceRecordResponse> update(
            @PathVariable Long id, @RequestBody MaintenanceRecordRequest body, HttpServletRequest req) {
        return ResponseEntity.ok(service.update(id, userId(req), body));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(
            @PathVariable Long id, HttpServletRequest req) {
        service.delete(id, userId(req));
        return ResponseEntity.ok(Map.of("status", "deleted"));
    }

    @GetMapping("/analytics")
    public ResponseEntity<MaintenanceAnalyticsResponse> analytics(HttpServletRequest req) {
        return ResponseEntity.ok(service.analytics(userId(req)));
    }

    @PostMapping("/seed")
    public ResponseEntity<Map<String, String>> seed(HttpServletRequest req) {
        service.seedSampleRecords(userId(req));
        return ResponseEntity.ok(Map.of("status", "seeded"));
    }

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> upload(
            @RequestParam("file") MultipartFile file,
            HttpServletRequest req) {
        Long uid = userId(req);
        if (file.isEmpty() || file.getSize() > 10_000_000) {
            return ResponseEntity.badRequest().body(Map.of("error", "File too large or empty"));
        }
        try {
            Files.createDirectories(UPLOAD_DIR);
            String ext = "";
            String origName = file.getOriginalFilename();
            if (origName != null && origName.contains(".")) {
                ext = origName.substring(origName.lastIndexOf('.'));
            }
            String filename = uid + "_" + UUID.randomUUID().toString().substring(0, 8) + ext;
            file.transferTo(UPLOAD_DIR.resolve(filename).toFile());
            String url = "/uploads/maintenance/" + filename;
            return ResponseEntity.ok(Map.of("url", url, "filename", filename));
        } catch (IOException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", "Upload failed"));
        }
    }
}
