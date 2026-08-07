package com.homeplatform.service;

import com.homeplatform.dto.*;
import com.homeplatform.model.MaintenanceRecord;
import com.homeplatform.model.MaintenanceRecord.Status;
import com.homeplatform.repository.MaintenanceRecordRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class MaintenanceService {

    private static final Logger log = LoggerFactory.getLogger(MaintenanceService.class);

    private final MaintenanceRecordRepository repo;

    public MaintenanceService(MaintenanceRecordRepository repo) {
        this.repo = repo;
    }

    // ── CRUD ──

    public List<MaintenanceRecordResponse> list(Long userId, String category, String area,
                                                  String status, String priority, String search,
                                                  Integer year, int limit) {
        var spec = MaintenanceRecordSpecs.withFilters(userId, category, area, status, priority, search, year);
        return repo.findAll(spec, PageRequest.of(0, Math.min(limit, 200)))
                .stream().map(this::toResponse).toList();
    }

    @Transactional
    public MaintenanceRecordResponse create(Long userId, MaintenanceRecordRequest req) {
        MaintenanceRecord r = MaintenanceRecord.builder()
                .userId(userId)
                .title(req.title())
                .description(req.description())
                .category(req.category())
                .area(req.area())
                .priority(MaintenanceRecord.Priority.valueOf(req.priority().toUpperCase()))
                .status(MaintenanceRecord.Status.valueOf(req.status().toUpperCase()))
                .scheduledDate(req.scheduledDate())
                .startedDate(req.startedDate())
                .completedDate(req.completedDate())
                .requestedBy(req.requestedBy())
                .completedBy(req.completedBy())
                .cost(req.cost())
                .contractorName(req.contractorName())
                .company(req.company())
                .receiptNumber(req.receiptNumber())
                .warrantyExpiration(req.warrantyExpiration())
                .photosBefore(req.photosBefore())
                .photosDuring(req.photosDuring())
                .photosAfter(req.photosAfter())
                .documents(req.documents())
                .notes(req.notes())
                .build();

        // If status is COMPLETED and no completedDate, set it now
        if (r.getStatus() == Status.COMPLETED && r.getCompletedDate() == null) {
            r.setCompletedDate(LocalDate.now());
        }

        r = repo.save(r);
        log.info("Maintenance record created: {} (user={})", r.getTitle(), userId);
        return toResponse(r);
    }

    @Transactional
    public MaintenanceRecordResponse update(Long id, Long userId, MaintenanceRecordRequest req) {
        MaintenanceRecord r = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Record not found"));
        if (!r.getUserId().equals(userId)) throw new SecurityException("Not authorized");

        if (req.title() != null) r.setTitle(req.title());
        if (req.description() != null) r.setDescription(req.description());
        if (req.category() != null) r.setCategory(req.category());
        if (req.area() != null) r.setArea(req.area());
        if (req.priority() != null) r.setPriority(MaintenanceRecord.Priority.valueOf(req.priority().toUpperCase()));
        if (req.status() != null) {
            Status newStatus = MaintenanceRecord.Status.valueOf(req.status().toUpperCase());
            r.setStatus(newStatus);
            if (newStatus == Status.COMPLETED && r.getCompletedDate() == null) {
                r.setCompletedDate(LocalDate.now());
            }
        }
        if (req.scheduledDate() != null) r.setScheduledDate(req.scheduledDate());
        if (req.startedDate() != null) r.setStartedDate(req.startedDate());
        if (req.completedDate() != null) r.setCompletedDate(req.completedDate());
        if (req.requestedBy() != null) r.setRequestedBy(req.requestedBy());
        if (req.completedBy() != null) r.setCompletedBy(req.completedBy());
        if (req.cost() != null) r.setCost(req.cost());
        if (req.contractorName() != null) r.setContractorName(req.contractorName());
        if (req.company() != null) r.setCompany(req.company());
        if (req.receiptNumber() != null) r.setReceiptNumber(req.receiptNumber());
        if (req.warrantyExpiration() != null) r.setWarrantyExpiration(req.warrantyExpiration());
        if (req.photosBefore() != null) r.setPhotosBefore(req.photosBefore());
        if (req.photosDuring() != null) r.setPhotosDuring(req.photosDuring());
        if (req.photosAfter() != null) r.setPhotosAfter(req.photosAfter());
        if (req.documents() != null) r.setDocuments(req.documents());
        if (req.notes() != null) r.setNotes(req.notes());

        r = repo.save(r);
        log.info("Maintenance record updated: {} (id={})", r.getTitle(), id);
        return toResponse(r);
    }

    public MaintenanceRecordResponse getById(Long id, Long userId) {
        MaintenanceRecord r = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Record not found"));
        if (!r.getUserId().equals(userId)) throw new SecurityException("Not authorized");
        return toResponse(r);
    }

    @Transactional
    public void delete(Long id, Long userId) {
        MaintenanceRecord r = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Record not found"));
        if (!r.getUserId().equals(userId)) throw new SecurityException("Not authorized");
        repo.delete(r);
        log.info("Maintenance record deleted: {} (id={})", r.getTitle(), id);
    }

    // ── Analytics ──

    public MaintenanceAnalyticsResponse analytics(Long userId) {
        long openCount = repo.countByUserIdAndStatus(userId, Status.SCHEDULED)
                       + repo.countByUserIdAndStatus(userId, Status.IN_PROGRESS);
        long scheduledCount = repo.countByUserIdAndStatus(userId, Status.SCHEDULED);
        long completedCount = repo.countCompleted(userId);
        BigDecimal totalCost = repo.sumActualCostCompleted(userId);
        BigDecimal thisYearCost = repo.sumActualCostCompletedSince(userId, LocalDate.now().withDayOfYear(1));
        long monthsActive = Math.max(1, ChronoUnit.MONTHS.between(
                repo.findCompletedByUserId(userId, PageRequest.of(0, 1))
                        .stream().findFirst().map(MaintenanceRecord::getCompletedDate).orElse(LocalDate.now()),
                LocalDate.now()));
        BigDecimal avgMonthly = completedCount > 0
                ? totalCost.divide(BigDecimal.valueOf(monthsActive), 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        // Last activity
        var lastRecord = repo.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        String lastActivity = lastRecord != null ? lastRecord.getTitle() : "None";
        String lastActivityDate = lastRecord != null ? lastRecord.getCreatedAt().toString() : null;

        // Cost by year
        var completed = repo.findCompletedByUserId(userId, PageRequest.of(0, 500));
        Map<Integer, BigDecimal> byYear = completed.stream()
                .filter(r -> r.getCompletedDate() != null && r.getCost() != null)
                .collect(Collectors.groupingBy(r -> r.getCompletedDate().getYear(),
                         Collectors.reducing(BigDecimal.ZERO, MaintenanceRecord::getCost, BigDecimal::add)));
        List<Map<String, Object>> costByYear = byYear.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> Map.<String, Object>of("year", e.getKey(), "cost", e.getValue()))
                .toList();

        // Cost by category
        Map<String, BigDecimal> byCat = completed.stream()
                .filter(r -> r.getCost() != null)
                .collect(Collectors.groupingBy(MaintenanceRecord::getCategory,
                         Collectors.reducing(BigDecimal.ZERO, MaintenanceRecord::getCost, BigDecimal::add)));
        List<Map<String, Object>> costByCategory = byCat.entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .limit(10)
                .map(e -> Map.<String, Object>of("category", e.getKey(), "cost", e.getValue()))
                .toList();

        // Most expensive
        List<Map<String, Object>> topExpensive = completed.stream()
                .filter(r -> r.getCost() != null)
                .sorted((a, b) -> b.getCost().compareTo(a.getCost()))
                .limit(5)
                .map(r -> Map.<String, Object>of(
                        "id", r.getId(), "title", r.getTitle(),
                        "cost", r.getCost(), "date", r.getCompletedDate()))
                .toList();

        return new MaintenanceAnalyticsResponse(openCount, scheduledCount, completedCount,
                totalCost, thisYearCost, avgMonthly, lastActivity, lastActivityDate,
                costByYear, costByCategory, topExpensive);
    }

    // ── Seed ──

    @Transactional
    public void seedSampleRecords(Long userId) {
        if (repo.count() > 0) return;

        var now = LocalDate.now();
        var records = List.of(
                record(userId, "HVAC Filter Replacement", "Replaced 20x25x1 MERV 11 filter", "HVAC", "Whole House",
                        Status.COMPLETED, "MEDIUM", now.minusDays(3), now.minusDays(3), now.minusDays(2),
                        new BigDecimal("18.99"), "Bryan", "Bryan",
                        null, null, null, null, "Monthly replacement. Using Nordic Pure filters."),
                record(userId, "Water Heater Installation", "Installed GE 50-gallon hybrid electric water heater", "Plumbing", "Garage",
                        Status.COMPLETED, "HIGH", now.minusMonths(4).minusDays(2), now.minusMonths(4), now.minusMonths(4).plusDays(1),
                        new BigDecimal("1895.00"), "Bryan", "Mike's Plumbing",
                        "Mike's Plumbing", "Mike's Plumbing LLC", "R-2026-0412", now.plusYears(12),
                        "Replaced with GE GeoSpring hybrid. Expansion tank installed. Warranty 12 years parts & labor."),
                record(userId, "Living Room Paint", "Full repaint — ceiling, walls, trim", "Painting", "Living Room",
                        Status.COMPLETED, "LOW", now.minusMonths(2).minusWeeks(1), now.minusMonths(2), now.minusMonths(2).plusDays(2),
                        new BigDecimal("425.00"), "Sarah", "Bryan",
                        null, null, null, null, "Benjamin Moore 'Swiss Coffee' OC-45 eggshell."),
                record(userId, "Roof Inspection", "Annual roof inspection after hail season", "Roof", "Roof",
                        Status.COMPLETED, "MEDIUM", now.minusMonths(5), now.minusMonths(5), now.minusMonths(5),
                        new BigDecimal("150.00"), "Bryan", "Apex Roofing",
                        "Apex Roofing", "Apex Roofing", "R-2026-0109", null, "No damage found. Good for another year."),
                record(userId, "Kitchen Faucet Replacement", "Replaced leaking pull-down faucet", "Plumbing", "Kitchen",
                        Status.COMPLETED, "HIGH", now.minusMonths(1).minusDays(1), now.minusMonths(1), now.minusMonths(1),
                        new BigDecimal("298.50"), "Sarah", "Bryan",
                        null, null, null, null, "Moen Arbor 7594ESRS. Spot-resist stainless."),
                record(userId, "Garage Door Opener Repair", "Chain tension + sensor realignment", "General Repair", "Garage",
                        Status.COMPLETED, "LOW", now.minusWeeks(3), now.minusWeeks(3), now.minusWeeks(3),
                        null, "Bryan", "Bryan",
                        null, null, null, null, "DIY fix. Tightened chain 1.5 turns. Realigned sensors."),
                record(userId, "Sprinkler System Winterization", "Blow-out and shut down for winter", "Landscaping", "Backyard",
                        Status.SCHEDULED, "MEDIUM", now.plusMonths(3), null, null,
                        new BigDecimal("85.00"), "Bryan", null,
                        "Green Lawn Services", "Green Lawn Services", null, null, "Schedule before first freeze."),
                record(userId, "Deck Power Wash & Seal", "Annual deck maintenance", "Exterior", "Backyard",
                        Status.SCHEDULED, "MEDIUM", now.plusMonths(1), null, null,
                        new BigDecimal("200.00"), "Bryan", null,
                        null, null, null, null, "Thompsons WaterSeal clear. Rent power washer."),
                record(userId, "Whole-Home Surge Protector", "Install Siemens FS140 at main panel", "Electrical", "Garage",
                        Status.IN_PROGRESS, "EMERGENCY", now.minusDays(1), now.minusDays(1), null,
                        new BigDecimal("450.00"), "Bryan", null,
                        "Elite Electric", "Elite Electric Co.", "EST-2026-0815", null, "Scheduled for Friday."),
                record(userId, "Attic Insulation Upgrade", "Add blown-in cellulose R-49", "General Repair", "Attic",
                        Status.SCHEDULED, "MEDIUM", now.plusWeeks(1), null, null,
                        new BigDecimal("1800.00"), "Bryan", null,
                        "Green Energy Insulation", "Green Energy Insulation", null, null, "Includes air sealing. Tax credit eligible.")
        );

        repo.saveAll(records);
        log.info("Seeded {} sample maintenance records for user {}", records.size(), userId);
    }

    private MaintenanceRecord record(Long userId, String title, String desc, String cat, String area,
                                      Status status, String priority, LocalDate scheduled, LocalDate started,
                                      LocalDate completed, BigDecimal cost, String requestedBy, String completedBy,
                                      String contractor, String company, String receipt,
                                      LocalDate warranty, String notes) {
        return MaintenanceRecord.builder()
                .userId(userId).title(title).description(desc).category(cat).area(area)
                .status(status).priority(MaintenanceRecord.Priority.valueOf(priority))
                .scheduledDate(scheduled)
                .startedDate(started)
                .completedDate(completed != null ? completed : (status == Status.COMPLETED ? started : null))
                .cost(cost)
                .requestedBy(requestedBy)
                .completedBy(completedBy)
                .contractorName(contractor).company(company).receiptNumber(receipt)
                .warrantyExpiration(warranty).notes(notes).build();
    }

    private MaintenanceRecordResponse toResponse(MaintenanceRecord r) {
        return new MaintenanceRecordResponse(
                r.getId(), r.getTitle(), r.getDescription(), r.getCategory(), r.getArea(),
                r.getPriority().name(), r.getStatus().name(),
                r.getScheduledDate(), r.getStartedDate(), r.getCompletedDate(),
                r.getCost(),
                r.getRequestedBy(), r.getCompletedBy(),
                r.getContractorName(), r.getCompany(), r.getReceiptNumber(), r.getWarrantyExpiration(),
                r.getPhotosBefore(), r.getPhotosDuring(), r.getPhotosAfter(), r.getDocuments(), r.getNotes(),
                r.getCreatedAt(), r.getUpdatedAt());
    }
}
