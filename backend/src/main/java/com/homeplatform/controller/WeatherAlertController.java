package com.homeplatform.controller;

import com.homeplatform.service.WeatherAlertRule;
import com.homeplatform.service.WeatherAlertService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Optional;

/** Profile → Weather alerts: which weather alerts a member gets, when, and at what limit. Members only. */
@RestController
@RequestMapping("/api/weather-alerts")
public class WeatherAlertController {

    private static final Logger log = LoggerFactory.getLogger(WeatherAlertController.class);

    private final WeatherAlertService service;

    public WeatherAlertController(WeatherAlertService service) {
        this.service = service;
    }

    /** Any field left out stays as it is. Times are "HH:mm", Central time. */
    public record UpdateRequest(Boolean inApp, Boolean push, String checkAt, String until, Integer threshold) {}

    @GetMapping
    public ResponseEntity<?> list(HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        return ResponseEntity.ok(service.list(userId(request)));
    }

    @PutMapping("/{type}")
    public ResponseEntity<?> update(@PathVariable String type, @RequestBody(required = false) UpdateRequest body,
                                    HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        Optional<WeatherAlertRule> rule = WeatherAlertRule.of(type);
        if (rule.isEmpty()) return badRequest("Unknown weather alert");
        if (body == null) return badRequest("Nothing to change");
        LocalTime checkAt;
        LocalTime until;
        try {
            checkAt = body.checkAt() == null ? null : LocalTime.parse(body.checkAt());
            until = body.until() == null ? null : LocalTime.parse(body.until());
        } catch (DateTimeParseException e) {
            return badRequest("Times look like 20:00");
        }
        if ((checkAt != null || until != null) && !rule.get().scheduled()) {
            return badRequest("This alert is sent as soon as there's a warning, so it has no times");
        }
        if (body.threshold() != null && !rule.get().allows(body.threshold())) {
            return badRequest("That limit isn't one of the choices");
        }
        return ResponseEntity.ok(service.update(userId(request), rule.get(),
                new WeatherAlertService.Change(body.inApp(), body.push(), checkAt, until, body.threshold())));
    }

    /** What the alert would say from the forecast right now. */
    @GetMapping("/{type}/preview")
    public ResponseEntity<?> preview(@PathVariable String type, HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        Optional<WeatherAlertRule> rule = WeatherAlertRule.of(type);
        if (rule.isEmpty()) return badRequest("Unknown weather alert");
        try {
            return ResponseEntity.ok(service.preview(userId(request), rule.get(), LocalDateTime.now(WeatherAlertService.CHICAGO)));
        } catch (RuntimeException e) {
            log.warn("Weather alert preview failed: {}", e.getMessage());
            return ResponseEntity.status(503).body(Map.of("error", "Couldn't reach the forecast. Try again in a minute."));
        }
    }

    private static boolean isMember(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        return "ADMIN".equals(role) || "USER".equals(role);
    }

    private static Long userId(HttpServletRequest request) {
        return (Long) request.getAttribute("userId");
    }

    private static ResponseEntity<Map<String, String>> forbidden() {
        return ResponseEntity.status(403).body(Map.of("error", "Access denied"));
    }

    private static ResponseEntity<Map<String, String>> badRequest(String error) {
        return ResponseEntity.badRequest().body(Map.of("error", error));
    }
}
