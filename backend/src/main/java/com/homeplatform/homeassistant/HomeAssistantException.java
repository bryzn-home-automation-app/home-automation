package com.homeplatform.homeassistant;

/**
 * Failures talking to Home Assistant. Controllers map these to HTTP statuses
 * (unavailable/auth/invalid → 503, upstream HTTP errors → 502). Messages never
 * include the HA token.
 */
public class HomeAssistantException extends RuntimeException {

    public HomeAssistantException(String message) {
        super(message);
    }

    public HomeAssistantException(String message, Throwable cause) {
        super(message, cause);
    }

    /** Integration disabled, HA unreachable, or timed out. */
    public static class Unavailable extends HomeAssistantException {
        public Unavailable(String message) { super(message); }
        public Unavailable(String message, Throwable cause) { super(message, cause); }
    }

    /** HA rejected the token (401/403). */
    public static class Auth extends HomeAssistantException {
        public Auth(String message) { super(message); }
    }

    /** HA answered with an unexpected HTTP status. */
    public static class Http extends HomeAssistantException {
        private final int status;

        public Http(int status, String message) {
            super(message);
            this.status = status;
        }

        public int getStatus() { return status; }
    }

    /** HA answered 2xx but the body wasn't what we expected. */
    public static class InvalidResponse extends HomeAssistantException {
        public InvalidResponse(String message) { super(message); }
        public InvalidResponse(String message, Throwable cause) { super(message, cause); }
    }
}
