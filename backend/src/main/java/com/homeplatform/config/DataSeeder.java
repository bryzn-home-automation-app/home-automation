package com.homeplatform.config;

import com.homeplatform.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
@org.springframework.context.annotation.Profile("!test")
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final UserService userService;

    @Value("${app.admin.seed-email:bryznnguyen@gmail.com}")
    private String adminEmail;

    @Value("${app.admin.seed-username:bryzncode}")
    private String adminUsername;

    @Value("${app.admin.seed-password:bryzncode}")
    private String adminPassword;

    @Value("${app.admin.seed-display-name:Bryan}")
    private String adminDisplayName;

    public DataSeeder(UserService userService) {
        this.userService = userService;
    }

    @Override
    public void run(String... args) {
        log.info("Checking for admin user seed...");
        userService.seedAdminIfNeeded(adminEmail, adminUsername, adminPassword, adminDisplayName);
    }
}
