package com.homeplatform.controller;

import com.homeplatform.dto.ReminderRequest;
import com.homeplatform.service.ReminderService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Household reminders: the Reminders page and Home's Reminders panel. Admins and members can
 * see, add, change, delete and complete them; guests get 403 on every call.
 */
@RestController
@RequestMapping("/api/reminders")
public class ReminderController {

    private final ReminderService service;

    public ReminderController(ReminderService service) {
        this.service = service;
    }

    /** {@code date} is the occurrence ("2026-11-13"). */
    public record OccurrenceRequest(String date) {}

    public record AlertsRequest(Boolean alerts) {}

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.list()));
    }

    /** Only what shows on Home now: inside its heads-up window and not done. */
    @GetMapping("/due")
    public ResponseEntity<?> due(HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.due()));
    }

    /** The heads-up choices, with the presets' times. */
    @GetMapping("/heads-ups")
    public ResponseEntity<?> headsUps(HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(ReminderService.options()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable Long id, HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.get(id)));
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody(required = false) ReminderRequest body, HttpServletRequest request) {
        return member(request, () -> ResponseEntity.status(201).body(service.create(body, userId(request))));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody(required = false) ReminderRequest body,
                                    HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.update(id, body, userId(request))));
    }

    /** The reminder's alerts switch. */
    @PutMapping("/{id}/alerts")
    public ResponseEntity<?> alerts(@PathVariable Long id, @RequestBody(required = false) AlertsRequest body,
                                    HttpServletRequest request) {
        return member(request, () -> {
            if (body == null || body.alerts() == null) throw new IllegalArgumentException("Say whether alerts are on");
            return ResponseEntity.ok(service.setAlerts(id, body.alerts(), userId(request)));
        });
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, HttpServletRequest request) {
        return member(request, () -> {
            service.delete(id, userId(request));
            return ResponseEntity.ok(Map.of("status", "deleted"));
        });
    }

    /** Marks one occurrence done for the household. */
    @PostMapping("/{id}/complete")
    public ResponseEntity<?> complete(@PathVariable Long id, @RequestBody(required = false) OccurrenceRequest body,
                                      HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.complete(id, date(body), userId(request))));
    }

    /** Takes a completion back. */
    @PostMapping("/{id}/undo")
    public ResponseEntity<?> undo(@PathVariable Long id, @RequestBody(required = false) OccurrenceRequest body,
                                  HttpServletRequest request) {
        return member(request, () -> ResponseEntity.ok(service.undo(id, date(body), userId(request))));
    }

    private static LocalDate date(OccurrenceRequest body) {
        if (body == null || body.date() == null || body.date().isBlank()) {
            throw new IllegalArgumentException("Which day? Send the occurrence date, like 2026-11-13");
        }
        try {
            return LocalDate.parse(body.date().trim());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Dates look like 2026-11-13");
        }
    }

    /** Admins and members only; errors become plain messages. */
    private static ResponseEntity<?> member(HttpServletRequest request, Supplier<ResponseEntity<?>> action) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) {
            return ResponseEntity.status(403).body(Map.of("error", "Access denied"));
        }
        try {
            return action.get();
        } catch (ReminderService.NotFound e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private static Long userId(HttpServletRequest request) {
        return (Long) request.getAttribute("userId");
    }
}
