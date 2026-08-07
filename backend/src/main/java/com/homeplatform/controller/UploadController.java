package com.homeplatform.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/upload")
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);
    // Resolve relative to the JVM working directory (set to /app in Dockerfile)
    private static final Path AVATAR_DIR = Path.of(System.getProperty("user.dir", "."), "uploads", "avatars");
    private static final long MAX_SIZE = 5 * 1024 * 1024; // 5 MB

    @PostMapping("/avatar")
    public ResponseEntity<Map<String, String>> uploadAvatar(
            @RequestParam("file") MultipartFile file,
            HttpServletRequest request) {

        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }

        // Validate
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No file provided"));
        }
        if (file.getSize() > MAX_SIZE) {
            return ResponseEntity.badRequest().body(Map.of("error", "File too large (max 5 MB)"));
        }
        String contentType = file.getContentType();
        if (contentType == null || (!contentType.startsWith("image/"))) {
            return ResponseEntity.badRequest().body(Map.of("error", "Only image files are allowed"));
        }

        try {
            // Ensure directory exists
            Files.createDirectories(AVATAR_DIR);

            // Generate unique filename: userId_uuid.ext
            String originalName = file.getOriginalFilename();
            String ext = "";
            if (originalName != null && originalName.contains(".")) {
                ext = originalName.substring(originalName.lastIndexOf('.'));
            }
            String filename = userId + "_" + UUID.randomUUID().toString().substring(0, 8) + ext;
            Path target = AVATAR_DIR.resolve(filename);

            // Save file
            file.transferTo(target.toFile());

            // Return the URL path
            String url = "/uploads/avatars/" + filename;
            log.info("Avatar uploaded for user {}: {}", userId, url);

            return ResponseEntity.ok(Map.of("avatarUrl", url, "filename", filename));
        } catch (IOException e) {
            log.error("Failed to save avatar for user {}", userId, e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Failed to save file"));
        }
    }
}
