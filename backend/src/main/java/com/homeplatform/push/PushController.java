package com.homeplatform.push;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Phone alerts: members (USER/ADMIN) register devices; guests can't. Authenticated by
 * JwtAuthFilter, which sets the {@code userId}/{@code role} attributes.
 */
@RestController
@RequestMapping("/api/push")
public class PushController {

    public record Keys(String p256dh, String auth) {}

    /** The shape of the browser's PushSubscription.toJSON(). */
    public record SubscriptionRequest(String endpoint, Keys keys) {}

    private final PushService push;

    public PushController(PushService push) {
        this.push = push;
    }

    @GetMapping("/public-key")
    public Map<String, String> publicKey(HttpServletRequest request) {
        member(request);
        return Map.of("publicKey", push.publicKey());
    }

    @PostMapping("/subscriptions")
    public Map<String, Object> subscribe(@RequestBody SubscriptionRequest body, HttpServletRequest request) {
        Long user = member(request);
        if (body == null || body.endpoint() == null || body.keys() == null) {
            throw new IllegalArgumentException("endpoint and keys are required");
        }
        push.subscribe(user, body.endpoint(), body.keys().p256dh(), body.keys().auth(), request.getHeader("User-Agent"));
        return Map.of("subscribed", true);
    }

    @DeleteMapping("/subscriptions")
    public Map<String, Object> unsubscribe(@RequestParam String endpoint, HttpServletRequest request) {
        push.unsubscribe(member(request), endpoint);
        return Map.of("subscribed", false);
    }

    /** Whether this device's endpoint is registered for the caller. */
    @GetMapping("/subscriptions/status")
    public Map<String, Object> status(@RequestParam String endpoint, HttpServletRequest request) {
        return Map.of("subscribed", push.isSubscribed(member(request), endpoint));
    }

    @PostMapping("/test")
    public Map<String, Object> test(HttpServletRequest request) {
        return Map.of("delivered", push.sendTest(member(request)));
    }

    private static Long member(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) throw new SecurityException("Members only");
        return (Long) request.getAttribute("userId");
    }

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
