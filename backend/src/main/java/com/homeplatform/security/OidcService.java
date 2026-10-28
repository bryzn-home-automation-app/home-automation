package com.homeplatform.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWT;
import com.nimbusds.oauth2.sdk.*;
import com.nimbusds.oauth2.sdk.auth.ClientSecretBasic;
import com.nimbusds.oauth2.sdk.auth.Secret;
import com.nimbusds.oauth2.sdk.http.HTTPRequest;
import com.nimbusds.oauth2.sdk.id.ClientID;
import com.nimbusds.oauth2.sdk.id.Issuer;
import com.nimbusds.oauth2.sdk.id.State;
import com.nimbusds.oauth2.sdk.pkce.CodeChallengeMethod;
import com.nimbusds.oauth2.sdk.pkce.CodeVerifier;
import com.nimbusds.openid.connect.sdk.*;
import com.nimbusds.openid.connect.sdk.claims.IDTokenClaimsSet;
import com.nimbusds.openid.connect.sdk.op.OIDCProviderMetadata;
import com.nimbusds.openid.connect.sdk.validators.IDTokenValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;

/**
 * Home SSO (Authelia, ../home-sso) as an OpenID Connect client: authorization code + PKCE (S256),
 * state and nonce checked, the ID token verified (signature against the issuer's JWKS, iss, aud,
 * exp, nonce). It only answers "which email signed in"; UserService decides whether that email
 * may use the app, so roles and account status stay where they always were.
 */
@Service
public class OidcService {

    private static final Logger log = LoggerFactory.getLogger(OidcService.class);
    private static final int TIMEOUT_MS = 5_000;

    private final boolean enabled;
    private final String issuerUrl;
    private final ClientID clientId;
    private final Secret clientSecret;
    private final URI redirectUri;

    /**
     * Discovered once and reused. A failed discovery isn't cached, so the next sign-in retries; key
     * rotation is handled by the validator's remote JWK set.
     */
    private volatile Provider provider;

    private record Provider(OIDCProviderMetadata metadata, IDTokenValidator validator) {}

    public OidcService(@Value("${app.oidc.enabled:false}") boolean enabled,
                       @Value("${app.oidc.issuer:}") String issuerUrl,
                       @Value("${app.oidc.client-id:homeplatform}") String clientId,
                       @Value("${app.oidc.client-secret:}") String clientSecret,
                       @Value("${app.oidc.redirect-uri:}") String redirectUri) {
        this.enabled = enabled && !issuerUrl.isBlank() && !clientSecret.isBlank() && !redirectUri.isBlank();
        if (enabled && !this.enabled) {
            log.warn("Home SSO is enabled but OIDC_ISSUER, OIDC_CLIENT_SECRET or OIDC_REDIRECT_URI is blank; it stays off");
        }
        this.issuerUrl = issuerUrl;
        this.clientId = new ClientID(clientId);
        this.clientSecret = new Secret(clientSecret.isBlank() ? "unset" : clientSecret);
        this.redirectUri = redirectUri.isBlank() ? null : URI.create(redirectUri);
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** Where to send the browser to sign in, for a freshly created transaction. */
    public URI authorizationUri(OidcLoginStore.Transaction tx) throws Exception {
        return new AuthenticationRequest.Builder(
                ResponseType.CODE, new Scope("openid", "email", "profile"), clientId, redirectUri)
                .endpointURI(provider().metadata().getAuthorizationEndpointURI())
                .state(new State(tx.state()))
                .nonce(new Nonce(tx.nonce()))
                .codeChallenge(new CodeVerifier(tx.codeVerifier()), CodeChallengeMethod.S256)
                .build()
                .toURI();
    }

    public static OidcLoginStore.Transaction newTransaction() {
        return new OidcLoginStore.Transaction(
                new State().getValue(), new Nonce().getValue(), new CodeVerifier().getValue());
    }

    /**
     * Swaps the authorization code for tokens and verifies the ID token. Returns the signed-in
     * person's email (lower case). Throws if anything doesn't check out, including an email the
     * provider hasn't verified.
     */
    public String verifiedEmail(String code, OidcLoginStore.Transaction tx) throws Exception {
        Provider p = provider();
        TokenRequest request = new TokenRequest(
                p.metadata().getTokenEndpointURI(),
                new ClientSecretBasic(clientId, clientSecret),
                new AuthorizationCodeGrant(new AuthorizationCode(code), redirectUri, new CodeVerifier(tx.codeVerifier())));
        HTTPRequest http = request.toHTTPRequest();
        http.setConnectTimeout(TIMEOUT_MS);
        http.setReadTimeout(TIMEOUT_MS);

        TokenResponse response = OIDCTokenResponseParser.parse(http.send());
        if (!response.indicatesSuccess()) {
            ErrorObject err = response.toErrorResponse().getErrorObject();
            throw new IllegalStateException("token endpoint refused the code: " + err.getCode());
        }
        JWT idToken = ((OIDCTokenResponse) response.toSuccessResponse()).getOIDCTokens().getIDToken();
        IDTokenClaimsSet claims = p.validator().validate(idToken, new Nonce(tx.nonce()));

        String email = claims.getStringClaim("email");
        Boolean verified = claims.getBooleanClaim("email_verified");
        if (email == null || email.isBlank() || !Boolean.TRUE.equals(verified)) {
            throw new IllegalStateException("ID token has no verified email");
        }
        return email.trim().toLowerCase();
    }

    private Provider provider() throws Exception {
        Provider p = provider;
        if (p != null) return p;
        synchronized (this) {
            if (provider != null) return provider;
            try {
                OIDCProviderMetadata metadata = OIDCProviderMetadata.resolve(new Issuer(issuerUrl), TIMEOUT_MS, TIMEOUT_MS);
                IDTokenValidator validator = new IDTokenValidator(
                        metadata.getIssuer(), clientId, JWSAlgorithm.RS256, metadata.getJWKSetURI().toURL(),
                        new DefaultResourceRetriever(TIMEOUT_MS, TIMEOUT_MS));
                provider = new Provider(metadata, validator);
                return provider;
            } catch (Exception e) {
                log.warn("Home SSO: couldn't load the provider's metadata from {}: {}", issuerUrl, e.toString());
                throw e;
            }
        }
    }
}
