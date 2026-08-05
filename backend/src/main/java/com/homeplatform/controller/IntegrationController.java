package com.homeplatform.controller;

import com.homeplatform.integration.IntegrationAdapter;
import com.homeplatform.integration.IntegrationResult;
import com.homeplatform.integration.IntegrationSyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/integrations")
public class IntegrationController {

    private final IntegrationSyncService syncService;

    public IntegrationController(IntegrationSyncService syncService) {
        this.syncService = syncService;
    }

    /** List all registered integration adapters */
    @GetMapping
    public ResponseEntity<List<Map<String, String>>> listAdapters() {
        List<Map<String, String>> adapters = syncService.getAdapters().stream()
                .map(a -> Map.of(
                        "key", a.getProviderKey(),
                        "name", a.getProviderName(),
                        "healthy", String.valueOf(a.healthCheck())
                ))
                .toList();
        return ResponseEntity.ok(adapters);
    }

    /** Get last sync result for a specific provider */
    @GetMapping("/{providerKey}")
    public ResponseEntity<?> getProviderStatus(@PathVariable String providerKey) {
        IntegrationResult result = syncService.getLastResult(providerKey);
        if (result == null) {
            return ResponseEntity.ok(Map.of(
                    "providerKey", providerKey,
                    "status", "never_synced"
            ));
        }
        return ResponseEntity.ok(result);
    }

    /** Trigger sync for a specific provider */
    @PostMapping("/{providerKey}/sync")
    public ResponseEntity<?> triggerSync(@PathVariable String providerKey) {
        IntegrationResult result = syncService.syncProvider(providerKey);
        return ResponseEntity.ok(result);
    }

    /** Trigger sync for all registered providers */
    @PostMapping("/sync-all")
    public ResponseEntity<List<IntegrationResult>> triggerSyncAll() {
        List<IntegrationResult> results = syncService.syncAll();
        return ResponseEntity.ok(results);
    }
}
