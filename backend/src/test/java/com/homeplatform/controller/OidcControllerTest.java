package com.homeplatform.controller;

import com.homeplatform.dto.LoginResponse;
import com.homeplatform.security.OidcLoginStore;
import com.homeplatform.security.OidcService;
import com.homeplatform.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Sign-in only completes in the browser that started it, and no code or token rides in a URL. */
class OidcControllerTest {

    private OidcService oidc;
    private OidcLoginStore store;
    private UserService users;
    private OidcController controller;

    @BeforeEach
    void setUp() {
        oidc = mock(OidcService.class);
        store = new OidcLoginStore();
        users = mock(UserService.class);
        controller = new OidcController(oidc, store, users);
        when(oidc.isEnabled()).thenReturn(true);
    }

    private static String location(org.springframework.http.ResponseEntity<?> r) {
        return r.getHeaders().getFirst(HttpHeaders.LOCATION);
    }

    @Test
    @DisplayName("start sends the browser to the provider with a Secure HttpOnly transaction cookie")
    void start() throws Exception {
        when(oidc.authorizationUri(any())).thenReturn(URI.create("https://idp.example/authorize?x=1"));
        var r = controller.start();
        assertEquals(302, r.getStatusCode().value());
        assertEquals("https://idp.example/authorize?x=1", location(r));
        String cookie = r.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        assertTrue(cookie.startsWith("oidc_tx="));
        assertTrue(cookie.contains("HttpOnly") && cookie.contains("Secure") && cookie.contains("Path=/api/auth/oidc"));
    }

    @Test
    @DisplayName("start is refused when SSO is off")
    void startWhenOff() {
        when(oidc.isEnabled()).thenReturn(false);
        assertEquals("/login?sso_error=off", location(controller.start()));
    }

    @Test
    @DisplayName("a good callback hands the one-time code over in an HttpOnly cookie, not the URL")
    void goodCallback() throws Exception {
        var tx = new OidcLoginStore.Transaction("st", "n", "v");
        String txId = store.putTransaction(tx);
        when(oidc.verifiedEmail("c", tx)).thenReturn("kim@example.com");

        var r = controller.callback("c", "st", null, txId);
        assertEquals("/login?sso=1", location(r));
        var cookies = r.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith("oidc_tx=;")), "transaction cookie cleared");
        String handoff = cookies.stream().filter(c -> c.startsWith("oidc_handoff=")).findFirst().orElseThrow();
        assertTrue(handoff.contains("HttpOnly") && handoff.contains("Secure") && handoff.contains("Path=/api/auth/oidc"));
        String code = handoff.substring("oidc_handoff=".length(), handoff.indexOf(';'));
        assertEquals("kim@example.com", store.takeHandoff(code));
    }

    @Test
    @DisplayName("a callback with the wrong state, or without the cookie, is refused")
    void stateMismatch() throws Exception {
        String txId = store.putTransaction(new OidcLoginStore.Transaction("st", "n", "v"));
        assertEquals("/login?sso_error=expired", location(controller.callback("c", "other", null, txId)));
        assertEquals("/login?sso_error=expired", location(controller.callback("c", "st", null, null)));
        verify(oidc, never()).verifiedEmail(anyString(), any());
    }

    @Test
    @DisplayName("a transaction can't be replayed")
    void noReplay() throws Exception {
        var tx = new OidcLoginStore.Transaction("st", "n", "v");
        String txId = store.putTransaction(tx);
        when(oidc.verifiedEmail("c", tx)).thenReturn("kim@example.com");
        controller.callback("c", "st", null, txId);
        assertEquals("/login?sso_error=expired", location(controller.callback("c", "st", null, txId)));
    }

    @Test
    @DisplayName("a failed token check lands on the login page with an error")
    void verificationFails() throws Exception {
        var tx = new OidcLoginStore.Transaction("st", "n", "v");
        String txId = store.putTransaction(tx);
        when(oidc.verifiedEmail("c", tx)).thenThrow(new IllegalStateException("bad signature"));
        assertEquals("/login?sso_error=failed", location(controller.callback("c", "st", null, txId)));
    }

    @Test
    @DisplayName("exchange returns the usual login response once")
    void exchange() {
        LoginResponse resp = new LoginResponse("jwt", 2L, "kim", "Kim", "USER", null, null, null);
        when(users.ssoLogin(eq("kim@example.com"), any(), any())).thenReturn(resp);
        String code = store.putHandoff("kim@example.com");
        var req = new MockHttpServletRequest();

        var first = controller.exchange(code, req);
        assertEquals(200, first.getStatusCode().value());
        assertSame(resp, first.getBody());
        assertTrue(first.getHeaders().getFirst(HttpHeaders.SET_COOKIE).startsWith("oidc_handoff=;"), "cookie cleared");
        assertEquals(401, controller.exchange(code, req).getStatusCode().value());
    }

    @Test
    @DisplayName("exchange without this browser's cookie gets nothing")
    void exchangeWithoutCookie() {
        store.putHandoff("kim@example.com");
        assertEquals(401, controller.exchange(null, new MockHttpServletRequest()).getStatusCode().value());
        verifyNoInteractions(users);
    }

    @Test
    @DisplayName("exchange refuses an email with no member account")
    void exchangeUnknownEmail() {
        when(users.ssoLogin(any(), any(), any())).thenThrow(new IllegalArgumentException("No home account uses that email."));
        String code = store.putHandoff("stranger@example.com");
        assertEquals(403, controller.exchange(code, new MockHttpServletRequest()).getStatusCode().value());
    }
}
