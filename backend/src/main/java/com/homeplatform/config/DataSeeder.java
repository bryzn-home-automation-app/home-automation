package com.homeplatform.config;

import com.homeplatform.service.AppEventService;
import com.homeplatform.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@Component
@org.springframework.context.annotation.Profile("!test")
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final UserService userService;
    private final AppEventService appEventService;

    @Value("${app.admin.seed-email:bryznnguyen@gmail.com}")
    private String adminEmail;

    @Value("${app.admin.seed-username:bryzncode}")
    private String adminUsername;

    @Value("${app.admin.seed-password}")
    private String adminPassword;

    @Value("${app.admin.seed-display-name:Bryan}")
    private String adminDisplayName;

    public DataSeeder(UserService userService, AppEventService appEventService) {
        this.userService = userService;
        this.appEventService = appEventService;
    }

    @Override
    public void run(String... args) {
        // Read git commit hash — env var (runtime) > committed file > build-time file
        String commit = System.getenv().getOrDefault("GIT_COMMIT", "");
        if (commit.isBlank()) {
            try {
                commit = Files.readString(Path.of("/app/.git-commit")).trim();
            } catch (IOException ignored) {}
        }
        if (commit.isBlank()) {
            try {
                commit = Files.readString(Path.of("/app/git-commit.txt")).trim();
            } catch (IOException ignored) {}
        }
        if (commit.isBlank()) {
            commit = "unknown";
        }

        appEventService.info("system", "DataSeeder",
                "Backend starting up — commit=" + commit);
        log.info("Starting up (commit={}) — checking admin seed...", commit);
        userService.seedAdminIfNeeded(adminEmail, adminUsername, adminPassword, adminDisplayName);
        appEventService.info("system", "DataSeeder", "Backend startup complete (commit=" + commit + ")");
    }
}
