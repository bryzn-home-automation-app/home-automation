package com.homeplatform.integration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Orchestrates integration adapters: runs syncs, handles retries,
 * tracks results, and surfaces failures as notifications.
 */
@Service
public class IntegrationSyncService {

    private static final Logger log = LoggerFactory.getLogger(IntegrationSyncService.class);

    private final List<IntegrationAdapter> adapters;
    private final Map<String, IntegrationResult> lastResults = new ConcurrentHashMap<>();

    public IntegrationSyncService(List<IntegrationAdapter> adapters) {
        this.adapters = adapters;
        log.info("Registered {} integration adapters: {}",
                adapters.size(),
                adapters.stream().map(IntegrationAdapter::getProviderKey).toList());
    }

    public List<IntegrationAdapter> getAdapters() {
        return adapters;
    }

    public Map<String, IntegrationResult> getLastResults() {
        return lastResults;
    }

    public IntegrationResult getLastResult(String providerKey) {
        return lastResults.get(providerKey);
    }

    /**
     * Run sync for all registered adapters (typically called by scheduler).
     */
    public List<IntegrationResult> syncAll() {
        List<IntegrationResult> results = new ArrayList<>();
        for (IntegrationAdapter adapter : adapters) {
            try {
                IntegrationResult result = runSyncForAdapter(adapter);
                results.add(result);
                lastResults.put(adapter.getProviderKey(), result);
            } catch (Exception e) {
                log.error("Unexpected error syncing {}: {}", adapter.getProviderKey(), e.getMessage(), e);
                IntegrationResult errorResult = IntegrationResult.builder()
                        .providerKey(adapter.getProviderKey())
                        .providerName(adapter.getProviderName())
                        .success(false)
                        .build();
                errorResult.addError("Unexpected: " + e.getMessage());
                results.add(errorResult);
                lastResults.put(adapter.getProviderKey(), errorResult);
            }
        }
        return results;
    }

    /**
     * Run sync for a specific adapter.
     */
    @Async
    public IntegrationResult syncProvider(String providerKey) {
        return adapters.stream()
                .filter(a -> a.getProviderKey().equalsIgnoreCase(providerKey))
                .findFirst()
                .map(adapter -> {
                    IntegrationResult result = runSyncForAdapter(adapter);
                    lastResults.put(providerKey, result);
                    return result;
                })
                .orElseGet(() -> {
                    IntegrationResult notFound = IntegrationResult.builder()
                            .providerKey(providerKey)
                            .success(false)
                            .build();
                    notFound.addError("No adapter found for provider: " + providerKey);
                    return notFound;
                });
    }

    private IntegrationResult runSyncForAdapter(IntegrationAdapter adapter) {
        log.info("Starting sync for {} ({})", adapter.getProviderName(), adapter.getProviderKey());

        if (!adapter.authenticate()) {
            IntegrationResult result = IntegrationResult.builder()
                    .providerKey(adapter.getProviderKey())
                    .providerName(adapter.getProviderName())
                    .success(false)
                    .build();
            result.addError("Authentication failed");
            log.error("Sync failed for {}: authentication error", adapter.getProviderKey());
            return result;
        }

        // Default: sync last 30 days
        LocalDate end = LocalDate.now();
        LocalDate start = end.minusDays(30);

        return adapter.syncAll("default", start, end);
    }
}
