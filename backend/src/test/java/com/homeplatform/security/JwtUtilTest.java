package com.homeplatform.security;

import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class JwtUtilTest {

    private final JwtUtil jwtUtil = new JwtUtil(
        "this-is-a-32-byte-secret-key!!-xx", 3600000);

    @Nested
    @DisplayName("Token generation")
    class Generation {

        @Test
        @DisplayName("should generate a non-null, non-empty token")
        void generatesToken() {
            String token = jwtUtil.generateToken(1L, "bryzncode", "ADMIN");
            assertNotNull(token);
            assertFalse(token.isBlank());
        }

        @Test
        @DisplayName("should contain subject as userId")
        void containsUserId() {
            String token = jwtUtil.generateToken(42L, "testuser", "USER");
            assertEquals(Long.valueOf(42L), jwtUtil.getUserId(token));
        }

        @Test
        @DisplayName("should contain username claim")
        void containsUsername() {
            String token = jwtUtil.generateToken(1L, "uniqueuser", "ADMIN");
            assertEquals("uniqueuser", jwtUtil.getUsername(token));
        }

        @Test
        @DisplayName("should contain role claim")
        void containsRole() {
            String token = jwtUtil.generateToken(1L, "user", "GUEST");
            assertEquals("GUEST", jwtUtil.getRole(token));
        }
    }

    @Nested
    @DisplayName("Token validation")
    class Validation {

        @Test
        @DisplayName("should validate a valid token")
        void validatesValidToken() {
            String token = jwtUtil.generateToken(1L, "user", "ADMIN");
            assertTrue(jwtUtil.isTokenValid(token));
        }

        @Test
        @DisplayName("should reject an invalid token")
        void rejectsInvalidToken() {
            assertFalse(jwtUtil.isTokenValid("invalid.token.here"));
        }

        @Test
        @DisplayName("should reject an empty token")
        void rejectsEmptyToken() {
            assertFalse(jwtUtil.isTokenValid(""));
        }

        @Test
        @DisplayName("should reject a null token")
        void rejectsNullToken() {
            assertFalse(jwtUtil.isTokenValid(null));
        }

        @Test
        @DisplayName("should reject a tampered token")
        void rejectsTamperedToken() {
            String token = jwtUtil.generateToken(1L, "user", "ADMIN");
            String tampered = token.substring(0, token.length() - 4) + "XXXX";
            assertFalse(jwtUtil.isTokenValid(tampered));
        }

        @Test
        @DisplayName("should extract all claims from valid token")
        void extractsClaims() {
            String token = jwtUtil.generateToken(7L, "test", "USER");
            Claims claims = jwtUtil.validateToken(token);
            assertEquals("7", claims.getSubject());
            assertEquals("test", claims.get("username"));
            assertEquals("USER", claims.get("role"));
        }
    }

    @Nested
    @DisplayName("Token expiry")
    class Expiry {

        @Test
        @DisplayName("should reject expired token")
        void rejectsExpiredToken() throws InterruptedException {
            // Create a JwtUtil with 1ms expiry for testing
            JwtUtil shortLived = new JwtUtil(
                "32-byte-secret-key-for-testing!!", 1);
            String token = shortLived.generateToken(1L, "user", "GUEST");
            Thread.sleep(10); // wait for expiry
            assertFalse(shortLived.isTokenValid(token));
        }

        @Test
        @DisplayName("should have expiration in the future for new tokens")
        void futureExpiration() {
            String token = jwtUtil.generateToken(1L, "user", "ADMIN");
            Claims claims = jwtUtil.validateToken(token);
            assertTrue(claims.getExpiration().getTime() > System.currentTimeMillis());
        }
    }
}
