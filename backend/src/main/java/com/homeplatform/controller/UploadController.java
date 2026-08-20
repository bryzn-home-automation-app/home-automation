package com.homeplatform.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/upload")
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);
    // Resolve relative to the JVM working directory (set to /app in Dockerfile)
    private static final Path AVATAR_DIR = Path.of(System.getProperty("user.dir", "."), "uploads", "avatars")
            .toAbsolutePath().normalize();
    private static final long MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    // Allowlist of image extensions we accept — anything else is coerced to .png.
    // Never derive a path segment from the raw client filename (path-traversal guard).
    private static final Set<String> ALLOWED_EXT = Set.of(".png", ".jpg", ".jpeg", ".gif", ".webp");

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

            // Derive the extension from an allowlist only — never trust the raw
            // client filename in a path segment (a name like "a.png/../../x" would
            // otherwise walk out of AVATAR_DIR). Unknown extensions fall back to .png.
            String ext = safeExtension(file.getOriginalFilename());

            // Filename is entirely server-generated: userId + random uuid + safe ext.
            String filename = userId + "_" + UUID.randomUUID().toString().substring(0, 8) + ext;
            Path target = AVATAR_DIR.resolve(filename).normalize();

            // Defense in depth: refuse anything that escaped the intended directory.
            if (!target.startsWith(AVATAR_DIR)) {
                log.warn("Rejected avatar upload that resolved outside {}: {}", AVATAR_DIR, target);
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid file"));
            }

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

    /**
     * Return a safe, allowlisted extension (leading dot, lowercased) for a client
     * filename, defaulting to {@code .png}. Only the substring after the final dot
     * is considered, and only if it matches {@link #ALLOWED_EXT} — so no path
     * separators or traversal sequences can ever reach the resolved path.
     */
    private static String safeExtension(String originalName) {
        if (originalName == null) return ".png";
        int dot = originalName.lastIndexOf('.');
        if (dot < 0) return ".png";
        String ext = originalName.substring(dot).toLowerCase(Locale.ROOT);
        return ALLOWED_EXT.contains(ext) ? ext : ".png";
    }
}
