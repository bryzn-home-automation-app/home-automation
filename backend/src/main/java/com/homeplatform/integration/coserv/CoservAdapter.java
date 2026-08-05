package com.homeplatform.integration.coserv;

import com.homeplatform.integration.IntegrationAdapter;
import com.homeplatform.integration.IntegrationResult;
import com.homeplatform.model.*;
import com.homeplatform.repository.*;
import com.microsoft.playwright.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * CoServ integration adapter using Playwright browser automation.
 * Handles login, data extraction, file download, parsing, and normalization.
 */
@Component
public class CoservAdapter implements IntegrationAdapter {

    private static final Logger log = LoggerFactory.getLogger(CoservAdapter.class);
    private static final String PROVIDER_KEY = "coserv";
    private static final String PROVIDER_NAME = "CoServ Electric";
    private static final String IMPORT_DIR = "backend/src/main/resources/imports";

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
    public String getProviderKey() {
        return PROVIDER_KEY;
    }

    @Override
    public String getProviderName() {
        return PROVIDER_NAME;
    }

    @Override
    public boolean healthCheck() {
        try (Playwright playwright = Playwright.create()) {
            BrowserContext context = authService.login(playwright);
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
        try (Playwright playwright = Playwright.create()) {
            BrowserContext context = authService.login(playwright);
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
        long startTime = System.currentTimeMillis();
        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            UtilityAccount account = getOrCreateAccount(accountNumber);

            // TODO: Playwright navigation to usage page, download export file
            // For now, this is a scaffold — real selectors come once the portal is known
            log.info("CoServ usage sync: account={}, range=[{} to {}]", accountNumber, start, end);

            // Placeholder: in production this would:
            // 1. Navigate to usage history page
            // 2. Select date range
            // 3. Download CSV/XML export
            // 4. Save raw file to imports dir
            // 5. Parse and store

            result.setSuccess(true);
            result.setUsageRecordsSynced(0);  // placeholder
            result.setCompletedAt(LocalDateTime.now());
            result.setDurationMs(System.currentTimeMillis() - startTime);

        } catch (Exception e) {
            log.error("CoServ usage sync error: {}", e.getMessage(), e);
            result.addError("Usage sync failed: " + e.getMessage());
            result.setSuccess(false);
        }

        return result;
    }

    @Override
    public IntegrationResult syncBilling(String accountNumber, LocalDate start, LocalDate end) {
        long startTime = System.currentTimeMillis();
        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            UtilityAccount account = getOrCreateAccount(accountNumber);

            log.info("CoServ billing sync: account={}, range=[{} to {}]", accountNumber, start, end);

            // TODO: Playwright navigation to billing page, download bills
            // Placeholder — real implementation once portal selectors are known

            result.setSuccess(true);
            result.setBillRecordsSynced(0);  // placeholder
            result.setCompletedAt(LocalDateTime.now());
            result.setDurationMs(System.currentTimeMillis() - startTime);

        } catch (Exception e) {
            log.error("CoServ billing sync error: {}", e.getMessage(), e);
            result.addError("Billing sync failed: " + e.getMessage());
            result.setSuccess(false);
        }

        return result;
    }

    @Override
    public IntegrationResult syncAll(String accountNumber, LocalDate start, LocalDate end) {
        long startTime = System.currentTimeMillis();
        IntegrationResult result = IntegrationResult.builder()
                .providerKey(PROVIDER_KEY)
                .providerName(PROVIDER_NAME)
                .startedAt(LocalDateTime.now())
                .build();

        try {
            IntegrationResult usageResult = syncUsage(accountNumber, start, end);
            result.setUsageRecordsSynced(usageResult.getUsageRecordsSynced());
            result.getErrors().addAll(usageResult.getErrors());
            result.getRawFiles().addAll(usageResult.getRawFiles());

            IntegrationResult billResult = syncBilling(accountNumber, start, end);
            result.setBillRecordsSynced(billResult.getBillRecordsSynced());
            result.getErrors().addAll(billResult.getErrors());
            result.getRawFiles().addAll(billResult.getRawFiles());

            result.setSuccess(usageResult.isSuccess() && billResult.isSuccess());
        } catch (Exception e) {
            log.error("CoServ syncAll error: {}", e.getMessage(), e);
            result.addError("Sync failed: " + e.getMessage());
            result.setSuccess(false);
        }

        result.setCompletedAt(LocalDateTime.now());
        result.setDurationMs(System.currentTimeMillis() - startTime);
        return result;
    }

    /**
     * Get or create the UtilityAccount for the given CoServ account number.
     */
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

                    UtilityAccount account = UtilityAccount.builder()
                            .provider(provider)
                            .accountNumber(accountNumber)
                            .status("ACTIVE")
                            .build();
                    return accountRepo.save(account);
                });
    }

    /**
     * Archive a downloaded raw file to the imports directory.
     */
    private Path archiveDownload(byte[] content, String prefix, String extension) {
        try {
            Path importDir = Paths.get(IMPORT_DIR);
            Files.createDirectories(importDir);
            String filename = String.format("%s_%s.%s", prefix,
                    LocalDateTime.now().toString().replace(":", "-"), extension);
            Path dest = importDir.resolve(filename);
            Files.write(dest, content);
            log.info("Archived raw import: {}", dest);
            return dest;
        } catch (Exception e) {
            log.error("Failed to archive download: {}", e.getMessage(), e);
            return null;
        }
    }
}
