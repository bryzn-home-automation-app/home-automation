package com.homeplatform.integration.coserv;

import com.microsoft.playwright.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Handles Playwright-based authentication with the CoServ SmartHub portal.
 * SmartHub is an Angular Material SPA hosted by NISC.
 *
 * Login page: https://coserv.smarthub.coop/ui/#/login
 * Fields: input[aria-label="Email"], input[aria-label="Password"]
 * Submit: button:has-text("Sign In")
 */
@Service
public class CoservAuthService {

    private static final Logger log = LoggerFactory.getLogger(CoservAuthService.class);

    private final CoservConfig config;

    public CoservAuthService(CoservConfig config) {
        this.config = config;
    }

    /**
     * Log into SmartHub and return an authenticated browser context.
     * The caller is responsible for closing the browser when done.
     */
    public BrowserContext login(Playwright playwright) {
        Browser browser = playwright.chromium().launch(new BrowserType.LaunchOptions()
                .setHeadless(true));

        BrowserContext context = browser.newContext(new Browser.NewContextOptions()
                .setLocale("en-US"));

        Page page = context.newPage();

        try {
            log.info("Navigating to SmartHub login: {}", config.getPortalUrl());
            page.navigate(config.getPortalUrl(), new Page.NavigateOptions().setTimeout(30000));
            page.waitForTimeout(2000);

            // SmartHub Angular Material form fields
            page.locator("input[aria-label=\"Email\"]").fill(config.getUsername());
            page.locator("input[aria-label=\"Password\"]").fill(config.getPassword());
            page.locator("button:has-text(\"Sign In\")").click();
            page.waitForTimeout(5000);

            String currentUrl = page.url();
            boolean hasError = page.locator("text=Invalid Login").count() > 0;

            if (hasError) {
                log.error("SmartHub login failed — invalid credentials");
                page.screenshot(new Page.ScreenshotOptions()
                        .setPath(java.nio.file.Path.of("screenshots/coserv-login-failure.png")));
                context.close();
                browser.close();
                return null;
            }

            // Verify we landed on the home/dashboard page (not still on login)
            if (currentUrl.contains("/login") || currentUrl.contains("#/login")) {
                log.error("SmartHub login failed — still on login page after submit");
                page.screenshot(new Page.ScreenshotOptions()
                        .setPath(java.nio.file.Path.of("screenshots/coserv-login-redirect-failure.png")));
                context.close();
                browser.close();
                return null;
            }

            log.info("SmartHub login successful, landed at: {}", currentUrl);
            return context;

        } catch (Exception e) {
            log.error("SmartHub authentication error: {}", e.getMessage(), e);
            try {
                page.screenshot(new Page.ScreenshotOptions()
                        .setPath(java.nio.file.Path.of("screenshots/coserv-auth-error.png")));
            } catch (Exception se) {
                log.warn("Could not capture auth error screenshot", se);
            }
            context.close();
            browser.close();
            return null;
        }
    }

    /**
     * Check if the current SmartHub session is still valid.
     */
    public boolean isSessionValid(BrowserContext context) {
        try {
            Page page = context.pages().get(0);
            page.reload();
            String url = page.url().toLowerCase();
            return !url.contains("login") && !url.contains("signin");
        } catch (Exception e) {
            log.warn("Session validity check failed: {}", e.getMessage());
            return false;
        }
    }
}
