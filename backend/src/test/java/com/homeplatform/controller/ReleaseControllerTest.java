package com.homeplatform.controller;

import com.homeplatform.dto.ReleaseResponse;
import com.homeplatform.model.AppRelease;
import com.homeplatform.model.ReleaseChange;
import com.homeplatform.repository.AppReleaseRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Maps AppRelease rows to the tab's response shape, newest first. The repository
 * (and its ordering query) is stubbed so this is pure mapping logic — no DB.
 */
class ReleaseControllerTest {

    private AppRelease release(String version, String title, ReleaseChange... changes) {
        return AppRelease.builder()
                .version(version)
                .stage("beta")
                .releasedAt(LocalDate.of(2026, 8, 22))
                .title(title)
                .summary("summary for " + version)
                .changes(List.of(changes))
                .build();
    }

    @Test
    void mapsReleasesPreservingRepositoryOrderAndFields() {
        AppReleaseRepository repo = mock(AppReleaseRepository.class);
        // Repository already returns newest-first via findAllByOrderBySortOrderDesc.
        when(repo.findAllByOrderBySortOrderDesc()).thenReturn(List.of(
                release("1.1.0", "Second", new ReleaseChange("new", "shiny")),
                release("1.0.0", "First", new ReleaseChange("new", "baseline"))));

        List<ReleaseResponse> out = new ReleaseController(repo).list();

        assertEquals(2, out.size());
        assertEquals("1.1.0", out.get(0).version(), "newest first, order preserved");
        assertEquals("1.0.0", out.get(1).version());

        ReleaseResponse first = out.get(0);
        assertEquals("beta", first.stage());
        assertEquals("2026-08-22", first.releasedAt(), "date rendered as ISO yyyy-MM-dd string");
        assertEquals("Second", first.title());
        assertEquals("summary for 1.1.0", first.summary());
        assertEquals(1, first.changes().size());
        assertEquals("new", first.changes().get(0).getType());
        assertEquals("shiny", first.changes().get(0).getText());
    }

    @Test
    void returnsEmptyListWhenNoReleases() {
        AppReleaseRepository repo = mock(AppReleaseRepository.class);
        when(repo.findAllByOrderBySortOrderDesc()).thenReturn(List.of());
        assertTrue(new ReleaseController(repo).list().isEmpty());
    }
}
