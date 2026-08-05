package com.homeplatform.integration.coserv;

import com.microsoft.playwright.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;

/**
 * Handles Playwright-based authentication with the CoServ customer portal.
 * Manages login, session detection, and token/cookie refresh.
 */
@Service
public class CoservAuthService {

    private static final Logger log = LoggerFactory.getLogger(CoservAuthService.class);

    private final CoservConfig config;

    public CoservAuthService(CoservConfig config) {
        this.config = config;
    }

    /**
     * Log into CoServ portal and return an authenticated browser context.
     * The caller is responsible for closing the browser when done.
     */
    public BrowserContext login(Playwright playwright) {
        Browser browser = playwright.chromium().launch(new BrowserType.LaunchOptions()
                .setHeadless(true));

        BrowserContext context = browser.newContext(new Browser.NewContextOptions()
                .setLocale("en-US"));

        Page page = context.newPage();

        try {
            log.info("Navigating to CoServ portal: {}", config.getPortalUrl());
            page.navigate(config.getPortalUrl());

            // Wait for and fill login form
            // Note: selectors will need to be updated to match actual CoServ portal
            page.waitForSelector("input[name='username'], input[type='email'], #username",
                    new Page.WaitForSelectorOptions().setTimeout(10000));

            // Fill username
            if (page.locator("input[name='username']").count() > 0) {
                page.fill("input[name='username']", config.getUsername());
            } else if (page.locator("#username").count() > 0) {
                page.fill("#username", config.getUsername());
            }

            // Fill password
            if (page.locator("input[name='password']").count() > 0) {
                page.fill("input[name='password']", config.getPassword());
            } else if (page.locator("#password").count() > 0) {
                page.fill("#password", config.getPassword());
            }

            // Click submit
            page.click("button[type='submit'], input[type='submit']");

            // Wait for navigation after login
            page.waitForLoadState();

            // Verify login succeeded (no error message, redirected away from login)
            String currentUrl = page.url();
            boolean hasError = page.locator(".error, .alert-danger, .login-error").count() > 0;

            if (hasError) {
                log.error("CoServ login failed — error message detected on page");
                page.screenshot(new Page.ScreenshotOptions()
                        .setPath(Path.of("screenshots/coserv-login-failure.png")));
                context.close();
                browser.close();
                return null;
            }

            log.info("CoServ authentication successful, redirected to: {}", currentUrl);
            return context;

        } catch (Exception e) {
            log.error("CoServ authentication error: {}", e.getMessage(), e);
            try {
                page.screenshot(new Page.ScreenshotOptions()
                        .setPath(Path.of("screenshots/coserv-auth-error.png")));
            } catch (Exception se) {
                log.warn("Could not capture auth error screenshot", se);
            }
            context.close();
            browser.close();
            return null;
        }
    }

    /**
     * Check if the current session is still valid.
     */
    public boolean isSessionValid(BrowserContext context) {
        try {
            Page page = context.pages().get(0);
            page.reload();
            // If we're redirected to login, session expired
            String url = page.url().toLowerCase();
            return !url.contains("login") && !url.contains("signin");
        } catch (Exception e) {
            log.warn("Session validity check failed: {}", e.getMessage());
            return false;
        }
    }
}
