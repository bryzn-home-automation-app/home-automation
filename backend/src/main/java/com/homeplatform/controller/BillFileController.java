package com.homeplatform.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

/**
 * Bill PDFs, members only. They used to be served as static files under
 * {@code /uploads/bills/} with no authentication, and their names (account number +
 * bill date) are guessable — anyone on the LAN or guest Wi-Fi could download a bill
 * with the service address and account details. {@code StaticResourceConfig} no
 * longer serves that folder; this endpoint sits behind {@code JwtAuthFilter}.
 */
@RestController
@RequestMapping("/api/bills")
public class BillFileController {

    /** The stored {@code pdfPath} format, e.g. {@code bills/9002001851_2026-09-08.pdf}. */
    private static final Pattern PDF_PATH = Pattern.compile("^bills/[A-Za-z0-9._-]+\\.pdf$");

    private final Path billsDir;

    public BillFileController() {
        this(Path.of(System.getProperty("user.dir", "."), "uploads", "bills"));
    }

    BillFileController(Path billsDir) {
        this.billsDir = billsDir.toAbsolutePath().normalize();
    }

    /** {@code path} is a bill's stored {@code pdfPath}. 404 for anything else. */
    @GetMapping("/file")
    public ResponseEntity<Resource> file(@RequestParam String path, HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) return ResponseEntity.status(403).build();
        if (path == null || !PDF_PATH.matcher(path).matches() || path.contains("..")) {
            return ResponseEntity.notFound().build();
        }
        Path file = billsDir.resolve(path.substring("bills/".length())).normalize();
        if (!file.startsWith(billsDir) || !Files.isRegularFile(file)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .cacheControl(CacheControl.noStore())
                .body(new FileSystemResource(file));
    }
}
