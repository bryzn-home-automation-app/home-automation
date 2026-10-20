package com.homeplatform.controller;

import com.homeplatform.homeassistant.HomeAssistantException;
import com.homeplatform.homeassistant.HomeDeviceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * Error mapping for the smart-home controllers only. Messages are our own (never
 * HA response bodies), so nothing from HA — including the token — leaks to clients.
 */
@RestControllerAdvice(assignableTypes = {HomeController.class, HomeAdminController.class, CameraController.class})
public class HomeExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(HomeExceptionHandler.class);

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return error(HttpStatus.FORBIDDEN, e.getMessage());
    }

    @ExceptionHandler(HomeDeviceService.NotFound.class)
    public ResponseEntity<Map<String, String>> notFound(HomeDeviceService.NotFound e) {
        return error(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return error(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(HomeDeviceService.Unsupported.class)
    public ResponseEntity<Map<String, String>> unsupported(HomeDeviceService.Unsupported e) {
        return error(e.isNotImplemented() ? HttpStatus.NOT_IMPLEMENTED : HttpStatus.UNPROCESSABLE_ENTITY, e.getMessage());
    }

    @ExceptionHandler(HomeAssistantException.Http.class)
    public ResponseEntity<Map<String, String>> upstream(HomeAssistantException.Http e) {
        log.warn("Home Assistant call failed: {}", e.getMessage());
        return error(HttpStatus.BAD_GATEWAY, "Home Assistant rejected the request");
    }

    @ExceptionHandler(HomeAssistantException.class)
    public ResponseEntity<Map<String, String>> unavailable(HomeAssistantException e) {
        log.warn("Home Assistant unavailable: {}", e.getMessage());
        return error(HttpStatus.SERVICE_UNAVAILABLE, "Home Assistant is unavailable");
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message == null ? status.getReasonPhrase() : message));
    }
}
