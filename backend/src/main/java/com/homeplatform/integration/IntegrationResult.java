package com.homeplatform.integration;

import lombok.Builder;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Generic result DTO returned by all integration adapters.
 * Contains synced record counts, errors, and ingest traceability.
 */
@Data
@Builder
public class IntegrationResult {

    private String providerKey;
    private String providerName;
    private UUID batchId;

    @Builder.Default
    private boolean success = false;

    private int usageRecordsSynced;
    private int billRecordsSynced;

    @Builder.Default
    private List<String> errors = new ArrayList<>();

    @Builder.Default
    private List<String> tempFiles = new ArrayList<>();

    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private long durationMs;

    public void addError(String error) {
        this.errors.add(error);
    }

    public void addTempFile(String path) {
        this.tempFiles.add(path);
    }

    public int getTotalSynced() {
        return usageRecordsSynced + billRecordsSynced;
    }
}
