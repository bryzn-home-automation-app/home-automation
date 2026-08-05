package com.homeplatform.integration;

import lombok.Builder;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Generic result DTO returned by all integration adapters.
 * Contains synced record counts, errors, raw file paths, and timing info.
 */
@Data
@Builder
public class IntegrationResult {

    private String providerKey;
    private String providerName;

    @Builder.Default
    private boolean success = false;

    private int usageRecordsSynced;
    private int billRecordsSynced;

    @Builder.Default
    private List<String> errors = new ArrayList<>();

    @Builder.Default
    private List<String> rawFiles = new ArrayList<>();

    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private long durationMs;

    public void addError(String error) {
        this.errors.add(error);
    }

    public void addRawFile(String path) {
        this.rawFiles.add(path);
    }

    public int getTotalSynced() {
        return usageRecordsSynced + billRecordsSynced;
    }
}
