package com.homeplatform.integration.coserv;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * CoServ-specific configuration loaded from application.yml / environment.
 * Credentials must be provided via environment variables — never hardcoded.
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "coserv")
public class CoservConfig {

    /** CoServ customer portal URL */
    private String portalUrl = "https://myaccount.coserv.com";

    /** Portal login username */
    private String username;

    /** Portal login password */
    private String password;

    /** Sync schedule */
    private Sync sync = new Sync();

    @Data
    public static class Sync {
        private boolean enabled = true;
        private String cron = "0 0 * * * *";  // hourly default
    }
}
