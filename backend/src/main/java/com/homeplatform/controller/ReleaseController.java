package com.homeplatform.controller;

import com.homeplatform.dto.ReleaseResponse;
import com.homeplatform.repository.AppReleaseRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only release-notes API for the "What's New" tab. Sits under {@code /api/*}
 * so it's authenticated by {@code JwtAuthFilter} — every signed-in household
 * member can read it. Content is authored in code and seeded by {@code ReleaseSeeder}.
 */
@RestController
@RequestMapping("/api/releases")
public class ReleaseController {

    private final AppReleaseRepository repository;

    public ReleaseController(AppReleaseRepository repository) {
        this.repository = repository;
    }

    /** Full version history, newest first. */
    @GetMapping
    public List<ReleaseResponse> list() {
        return repository.findAllByOrderBySortOrderDesc().stream()
                .map(r -> new ReleaseResponse(
                        r.getVersion(),
                        r.getStage(),
                        r.getReleasedAt().toString(),
                        r.getTitle(),
                        r.getSummary(),
                        r.getChanges()))
                .toList();
    }
}
