package com.homeplatform.integration;

import java.time.LocalDate;

/**
 * Contract that every utility provider adapter must implement.
 * Isolates provider-specific behavior (CoServ, future providers)
 * from the core application domain.
 */
public interface IntegrationAdapter {

    /** Unique identifier for this provider (e.g. "coserv", "oncor") */
    String getProviderKey();

    /** Human-readable provider name (e.g. "CoServ Electric") */
    String getProviderName();

    /** Verify that the provider is reachable and credentials are valid */
    boolean healthCheck();

    /**
     * Authenticate with the provider portal.
     * @return true if authentication succeeded
     */
    boolean authenticate();

    /**
     * Sync energy usage data for the given date range.
     * @param accountNumber the provider account to sync
     * @param start start date (inclusive)
     * @param end end date (inclusive)
     * @return result with synced records and any errors
     */
    IntegrationResult syncUsage(String accountNumber, LocalDate start, LocalDate end);

    /**
     * Sync billing data for the given date range.
     * @param accountNumber the provider account to sync
     * @param start start date (inclusive)
     * @param end end date (inclusive)
     * @return result with synced records and any errors
     */
    IntegrationResult syncBilling(String accountNumber, LocalDate start, LocalDate end);

    /**
     * Combined sync: usage + billing for the given date range.
     * @param accountNumber the provider account to sync
     * @param start start date (inclusive)
     * @param end end date (inclusive)
     * @return result with synced records and any errors
     */
    IntegrationResult syncAll(String accountNumber, LocalDate start, LocalDate end);
}
