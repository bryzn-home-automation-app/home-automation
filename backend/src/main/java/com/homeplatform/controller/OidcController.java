package com.homeplatform.controller;

import com.homeplatform.security.OidcLoginStore;
import com.homeplatform.security.OidcService;
import com.homeplatform.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.time.Duration;
import java.util.Map;

/**
 * "Sign in with Home": the browser goes /start → home SSO → /callback → /login?sso=1, and the SPA
 * swaps the one-time code (in an HttpOnly cookie, never the URL) for the app's usual JWT at
 * /exchange. Password sign-in is unchanged.
 */
@RestController
@RequestMapping("/api/auth/oidc")
public class OidcController {

    private static final Logger log = LoggerFactory.getLogger(OidcController.class);
    static final String TX_COOKIE = "oidc_tx";
    static final String HANDOFF_COOKIE = "oidc_handoff";
    private static final String COOKIE_PATH = "/api/auth/oidc";

    private final OidcService oidc;
    private final OidcLoginStore store;
    private final UserService userService;

    public OidcController(OidcService oidc, OidcLoginStore store, UserService userService) {
        this.oidc = oidc;
        this.store = store;
        this.userService = userService;
    }

    /** Whether the login page should offer "Sign in with Home". */
    @GetMapping("/config")
    public Map<String, Boolean> config() {
        return Map.of("enabled", oidc.isEnabled());
    }

    @GetMapping("/start")
    public ResponseEntity<Void> start() {
        if (!oidc.isEnabled()) return redirect("/login?sso_error=off");
        OidcLoginStore.Transaction tx = OidcService.newTransaction();
        try {
            URI target = oidc.authorizationUri(tx);
            return redirect(target.toString(), cookie(TX_COOKIE, store.putTransaction(tx), OidcLoginStore.TX_TTL));
        } catch (Exception e) {
            return redirect("/login?sso_error=unavailable");
        }
    }

    @GetMapping("/callback")
    public ResponseEntity<Void> callback(@RequestParam(required = false) String code,
                                         @RequestParam(required = false) String state,
                                         @RequestParam(required = false) String error,
                                         @CookieValue(name = TX_COOKIE, required = false) String txId) {
        ResponseCookie clear = cookie(TX_COOKIE, "", Duration.ZERO);
        OidcLoginStore.Transaction tx = store.takeTransaction(txId);
        if (error != null) {
            log.info("Home SSO sign-in ended at the provider: {}", error);
            return redirect("/login?sso_error=denied", clear);
        }
        if (tx == null || code == null || state == null || !state.equals(tx.state())) {
            return redirect("/login?sso_error=expired", clear);
        }
        try {
            String email = oidc.verifiedEmail(code, tx);
            ResponseCookie handoff = cookie(HANDOFF_COOKIE, store.putHandoff(email), OidcLoginStore.HANDOFF_TTL);
            return redirect("/login?sso=1", clear, handoff);
        } catch (Exception e) {
            log.warn("Home SSO sign-in failed: {}", e.toString());
            return redirect("/login?sso_error=failed", clear);
        }
    }

    /** Same-origin POST from the SPA; the code comes from the cookie /callback set in this browser. */
    @PostMapping("/exchange")
    public ResponseEntity<?> exchange(@CookieValue(name = HANDOFF_COOKIE, required = false) String code,
                                      HttpServletRequest httpReq) {
        String clear = cookie(HANDOFF_COOKIE, "", Duration.ZERO).toString();
        String email = store.takeHandoff(code);
        if (email == null) {
            return ResponseEntity.status(401).header(HttpHeaders.SET_COOKIE, clear)
                    .body(Map.of("error", "That sign-in took too long. Please try again."));
        }
        try {
            return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, clear)
                    .body(userService.ssoLogin(email, clientIp(httpReq), httpReq.getHeader("User-Agent")));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.status(403).header(HttpHeaders.SET_COOKIE, clear)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    private static ResponseCookie cookie(String name, String value, Duration maxAge) {
        // Secure: SSO only runs on the HTTPS origin. Lax: the provider's redirect back is a
        // top-level GET, which Lax still sends the cookie on.
        return ResponseCookie.from(name, value)
                .path(COOKIE_PATH).httpOnly(true).secure(true).sameSite("Lax").maxAge(maxAge).build();
    }

    private static ResponseEntity<Void> redirect(String location, ResponseCookie... cookies) {
        ResponseEntity.BodyBuilder b = ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, location);
        for (ResponseCookie c : cookies) {
            if (c != null) b.header(HttpHeaders.SET_COOKIE, c.toString());
        }
        return b.build();
    }

    /** nginx replaces X-Forwarded-For with the real client address, so it can be trusted here. */
    private static String clientIp(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        return fwd != null && !fwd.isBlank() ? fwd.split(",")[0].trim() : req.getRemoteAddr();
    }
}
