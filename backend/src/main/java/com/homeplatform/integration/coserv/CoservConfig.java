package com.homeplatform.integration.coserv;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * CoServ SmartHub portal configuration.
 * Credentials must be provided via environment variables — never hardcoded.
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "coserv")
public class CoservConfig {

    /** SmartHub customer portal login page */
    private String portalUrl = "https://coserv.smarthub.coop/ui/#/login";

    /** SmartHub Green Button download page */
    private String greenButtonPath = "#/usageManagement/greenButton";

    /** Portal login email */
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
