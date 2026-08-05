package com.homeplatform.integration.coserv;

import com.homeplatform.integration.IntegrationAdapter;
import com.homeplatform.integration.IntegrationResult;
import com.homeplatform.model.*;
import com.homeplatform.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * CoServ integration adapter using Playwright browser automation.
 *
 * Data flow:
 * 1. Download exports to a temp directory
 * 2. Parse & validate
 * 3. Normalize & insert into PostgreSQL (append-only)
 * 4. Delete temp files immediately after successful processing
 *
 * Downloaded files are NEVER archived — the database is the sole source of truth.
 */
@Component
public class CoservAdapter implements IntegrationAdapter {

    private static final Logger log = LoggerFactory.getLogger(CoservAdapter.class);
    private static final String PROVIDER_KEY = "coserv";
    private static final String PROVIDER_NAME = "CoServ Electric";
    private static final String PROCESSING_VERSION = "1.0";
    private static final Path TEMP_DIR = Path.of(System.getProperty("java.io.tmpdir"), "homeplatform-coserv");

    private final CoservConfig config;
    private final CoservAuthService authService;
    private final CoservDataParser parser;
    private final UtilityProviderRepository providerRepo;
    private final UtilityAccountRepository accountRepo;
    private final MeterRepository meterRepo;
    private final EnergyUsageRepository usageRepo;
    private final UtilityBillRepository billRepo;

    public CoservAdapter(CoservConfig config,
                         CoservAuthService authService,
                         CoservDataParser parser,
                         UtilityProviderRepository providerRepo,
                         UtilityAccountRepository accountRepo,
                         MeterRepository meterRepo,
                         EnergyUsageRepository usageRepo,
                         UtilityBillRepository billRepo) {
        this.config = config;
        this.authService = authService;
        this.parser = parser;
        this.providerRepo = providerRepo;
        this.accountRepo = accountRepo;
        this.meterRepo = meterRepo;
        this.usageRepo = usageRepo;
        this.billRepo = billRepo;
    }

    @Override
    public String getProviderKey() { return PROVIDER_KEY; }

    @Override
    public String getProviderName() { return PROVIDER_NAME; }

    @Override
    public boolean healthCheck() {
        try (com.microsoft.playwright.Playwright playwright = com.microsoft.playwright.Playwright.create()) {
            com.microsoft.playwright.BrowserContext context = authService.login(playwright);
            if (context != null) {
                context.close();
                return true;
            }
            return false;
        } catch (Exception e) {
            log.error("CoServ health check failed: {}", e.getMessage());
            return false;
        }
    }

    @Override
    public boolean authenticate() {
        try (com.microsoft.playwright.Playwright playwright = com.microsoft.playwright.Playwright.create()) {
            com.microsoft.playwright.BrowserContext context = authService.login(playwright);
            boolean success = context != null;
            if (context != null) context.close();
            return success;
        } catch (Exception e) {
            log.error("CoServ authentication failed: {}", e.getMessage(), e);
            return false;
        }
    }

    @Override
    public IntegrationResult syncUsage(String accountNumber, LocalDate start, LocalDate end) {
        UUID batchId = UUID.randomUUID();
        long startTime = System.currentTimeMillis();
        List<Path> tempFiles = new ArrayList<>();

        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .batchId(batchId)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            UtilityAccount account = getOrCreateAccount(accountNumber);
            Meter meter = getOrCreateMeter(account);

            // TODO: Playwright navigation to usage page, download export file
            // For now, this is a scaffold — real selectors come once the portal is known
            log.info("CoServ usage sync: batchId={}, account={}, range=[{} to {}]",
                    batchId, accountNumber, start, end);

            // Placeholder: in production this would:
            // 1. Navigate to usage history page
            // 2. Select date range
            // 3. Download CSV/XML export to TEMP_DIR
            // 4. Parse into EnergyUsage records with batchId + processing version
            // 5. Save to DB via usageRepo.saveAll()
            // 6. Add file paths to tempFiles list

            result.setSuccess(true);
            result.setUsageRecordsSynced(0);  // placeholder

        } catch (Exception e) {
            log.error("CoServ usage sync error (batchId={}): {}", batchId, e.getMessage(), e);
            result.addError("Usage sync failed: " + e.getMessage());
            result.setSuccess(false);
        } finally {
            cleanupTempFiles(tempFiles);
        }

        result.setCompletedAt(LocalDateTime.now());
        result.setDurationMs(System.currentTimeMillis() - startTime);
        return result;
    }

    @Override
    public IntegrationResult syncBilling(String accountNumber, LocalDate start, LocalDate end) {
        UUID batchId = UUID.randomUUID();
        long startTime = System.currentTimeMillis();
        List<Path> tempFiles = new ArrayList<>();

        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .batchId(batchId)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            UtilityAccount account = getOrCreateAccount(accountNumber);

            log.info("CoServ billing sync: batchId={}, account={}, range=[{} to {}]",
                    batchId, accountNumber, start, end);

            // TODO: Playwright navigation to billing page, download bills
            // Same pattern as syncUsage — download, parse, store, delete temp files

            result.setSuccess(true);
            result.setBillRecordsSynced(0);  // placeholder

        } catch (Exception e) {
            log.error("CoServ billing sync error (batchId={}): {}", batchId, e.getMessage(), e);
            result.addError("Billing sync failed: " + e.getMessage());
            result.setSuccess(false);
        } finally {
            cleanupTempFiles(tempFiles);
        }

        result.setCompletedAt(LocalDateTime.now());
        result.setDurationMs(System.currentTimeMillis() - startTime);
        return result;
    }

    @Override
    public IntegrationResult syncAll(String accountNumber, LocalDate start, LocalDate end) {
        UUID batchId = UUID.randomUUID();
        long startTime = System.currentTimeMillis();

        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .batchId(batchId)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            IntegrationResult usageResult = syncUsage(accountNumber, start, end);
            result.setUsageRecordsSynced(usageResult.getUsageRecordsSynced());
            result.getErrors().addAll(usageResult.getErrors());

            IntegrationResult billResult = syncBilling(accountNumber, start, end);
            result.setBillRecordsSynced(billResult.getBillRecordsSynced());
            result.getErrors().addAll(billResult.getErrors());

            result.setSuccess(usageResult.isSuccess() && billResult.isSuccess());
        } catch (Exception e) {
            log.error("CoServ syncAll error (batchId={}): {}", batchId, e.getMessage(), e);
            result.addError("Sync failed: " + e.getMessage());
            result.setSuccess(false);
        }

        result.setCompletedAt(LocalDateTime.now());
        result.setDurationMs(System.currentTimeMillis() - startTime);
        return result;
    }

    /**
     * Build an EnergyUsage record with all audit metadata populated.
     */
    public EnergyUsage buildUsageRecord(Meter meter, LocalDateTime timestamp,
                                         java.math.BigDecimal usageKwh, java.math.BigDecimal cost,
                                         UUID batchId) {
        return EnergyUsage.builder()
                .meter(meter)
                .timestamp(timestamp)
                .usageKwh(usageKwh)
                .cost(cost)
                .source(PROVIDER_NAME + " API")
                .sourceProvider(PROVIDER_KEY)
                .ingestionBatchId(batchId)
                .processingVersion(PROCESSING_VERSION)
                .build();
    }

    /**
     * Build a UtilityBill record with all audit metadata populated.
     */
    public UtilityBill buildBillRecord(UtilityAccount account, LocalDate periodStart,
                                        LocalDate periodEnd, java.math.BigDecimal usageKwh,
                                        java.math.BigDecimal amount, LocalDate dueDate,
                                        UUID batchId) {
        return UtilityBill.builder()
                .account(account)
                .billingPeriodStart(periodStart)
                .billingPeriodEnd(periodEnd)
                .usageKwh(usageKwh)
                .amount(amount)
                .dueDate(dueDate)
                .status("ISSUED")
                .source(PROVIDER_NAME + " API")
                .sourceProvider(PROVIDER_KEY)
                .ingestionBatchId(batchId)
                .processingVersion(PROCESSING_VERSION)
                .build();
    }

    // --- Private helpers ---

    private UtilityAccount getOrCreateAccount(String accountNumber) {
        return accountRepo.findByAccountNumber(accountNumber)
                .orElseGet(() -> {
                    UtilityProvider provider = providerRepo.findByName(PROVIDER_NAME)
                            .orElseGet(() -> providerRepo.save(
                                    UtilityProvider.builder()
                                            .name(PROVIDER_NAME)
                                            .type("ELECTRIC")
                                            .portalUrl(config.getPortalUrl())
                                            .build()
                            ));
                    return accountRepo.save(UtilityAccount.builder()
                            .provider(provider)
                            .accountNumber(accountNumber)
                            .status("ACTIVE")
                            .build());
                });
    }

    private Meter getOrCreateMeter(UtilityAccount account) {
        List<Meter> meters = meterRepo.findByAccountId(account.getId());
        if (!meters.isEmpty()) return meters.get(0);
        return meterRepo.save(Meter.builder()
                .account(account)
                .meterNumber("COSERV-" + account.getAccountNumber())
                .type("ELECTRIC")
                .build());
    }

    /**
     * Delete all temporary files after successful processing.
     * Files are never archived — the database is the permanent record.
     */
    private void cleanupTempFiles(List<Path> files) {
        for (Path file : files) {
            try {
                Files.deleteIfExists(file);
                log.debug("Deleted temp file: {}", file);
            } catch (IOException e) {
                log.warn("Failed to delete temp file {}: {}", file, e.getMessage());
            }
        }
    }
}
