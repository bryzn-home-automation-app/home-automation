package com.homeplatform.controller;

import com.homeplatform.model.UtilityProvider;
import com.homeplatform.repository.EnergyUsageRepository;
import com.homeplatform.repository.UtilityProviderRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Lightweight controller providing integration status.
 * Actual data sync is handled by the standalone Node.js scripts/sync.js CLI tool.
 */
@RestController
@RequestMapping("/api/integrations")
public class IntegrationController {

    private final UtilityProviderRepository providerRepo;
    private final DataSource dataSource;

    public IntegrationController(UtilityProviderRepository providerRepo,
                                  DataSource dataSource) {
        this.providerRepo = providerRepo;
        this.dataSource = dataSource;
    }

    /** List all registered providers with DB connectivity status */
    @GetMapping
    public ResponseEntity<List<Map<String, String>>> listProviders() {
        final boolean dbOk = checkDb();

        List<Map<String, String>> providers = providerRepo.findByIsActiveTrue().stream()
                .map(p -> Map.of(
                        "key", p.getName().toLowerCase(),
                        "name", p.getName(),
                        "type", p.getType(),
                        "healthy", String.valueOf(dbOk)
                ))
                .toList();

        return ResponseEntity.ok(providers);
    }

    /** Provider status summary */
    @GetMapping("/{providerKey}")
    public ResponseEntity<Map<String, Object>> getProviderStatus(@PathVariable String providerKey) {
        var provider = providerRepo.findByName(
                providerKey.substring(0, 1).toUpperCase() + providerKey.substring(1));

        if (provider.isEmpty()) {
            return ResponseEntity.ok(Map.of("providerKey", providerKey, "status", "not_found"));
        }

        final boolean dbOk = checkDb();

        return ResponseEntity.ok(Map.of(
                "providerKey", providerKey,
                "name", provider.get().getName(),
                "type", provider.get().getType(),
                "dbConnected", dbOk,
                "syncCommand", "npm run sync",
                "checkedAt", Instant.now().toString()
        ));
    }

    private boolean checkDb() {
        try (Connection conn = dataSource.getConnection()) {
            return conn.isValid(3);
        } catch (Exception e) {
            return false;
        }
    }
}
