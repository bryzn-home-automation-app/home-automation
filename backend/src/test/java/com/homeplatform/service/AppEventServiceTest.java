package com.homeplatform.service;

import com.homeplatform.model.AppEvent;
import com.homeplatform.repository.AppEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AppEventServiceTest {

    private AppEventService appEventService;
    private AppEventRepository repo;

    @BeforeEach
    void setUp() {
        repo = mock(AppEventRepository.class);
        appEventService = new AppEventService(repo);
    }

    @Nested
    @DisplayName("log")
    class Log {

        @Test
        @DisplayName("creates and persists an event with all fields")
        void logsAndPersists() {
            AppEvent saved = new AppEvent("sync", "INFO", "HourlySync", "started", null);
            saved.setTimestamp(LocalDateTime.now());
            when(repo.save(any(AppEvent.class))).thenReturn(saved);

            AppEvent result = appEventService.log("sync", "INFO", "HourlySync", "started", null);

            assertNotNull(result);
            assertEquals("sync", result.getCategory());
            assertEquals("INFO", result.getLevel());
            assertEquals("HourlySync", result.getSource());
            assertEquals("started", result.getMessage());
            verify(repo).save(any(AppEvent.class));
        }
    }

    @Nested
    @DisplayName("info")
    class Info {

        @Test
        @DisplayName("calls log with INFO level")
        void shorthandCallsLog() {
            AppEvent saved = new AppEvent("system", "INFO", "DataSeeder", "startup", null);
            saved.setTimestamp(LocalDateTime.now());
            when(repo.save(any(AppEvent.class))).thenReturn(saved);

            AppEvent result = appEventService.info("system", "DataSeeder", "startup");

            assertEquals("INFO", result.getLevel());
        }
    }

    @Nested
    @DisplayName("warn")
    class Warn {

        @Test
        @DisplayName("calls log with WARN level")
        void shorthandCallsLog() {
            AppEvent saved = new AppEvent("sync", "WARN", "Scheduler", "timeout", null);
            saved.setTimestamp(LocalDateTime.now());
            when(repo.save(any(AppEvent.class))).thenReturn(saved);

            AppEvent result = appEventService.warn("sync", "Scheduler", "timeout");

            assertEquals("WARN", result.getLevel());
        }
    }

    @Nested
    @DisplayName("error")
    class Error {

        @Test
        @DisplayName("calls log with ERROR level including details")
        void shorthandCallsLog() {
            AppEvent saved = new AppEvent("sync", "ERROR", "Scheduler", "crash", "stack trace");
            saved.setTimestamp(LocalDateTime.now());
            when(repo.save(any(AppEvent.class))).thenReturn(saved);

            AppEvent result = appEventService.error("sync", "Scheduler", "crash", "stack trace");

            assertEquals("ERROR", result.getLevel());
            assertEquals("stack trace", result.getDetails());
        }
    }

    @Nested
    @DisplayName("getRecent")
    class GetRecent {

        @Test
        @DisplayName("returns all when no filters")
        void noFilters() {
            when(repo.findRecent(any(LocalDateTime.class))).thenReturn(List.of());

            appEventService.getRecent(24, null, null);

            verify(repo).findRecent(any(LocalDateTime.class));
        }

        @Test
        @DisplayName("returns all when filter is 'all'")
        void filterAll() {
            when(repo.findRecent(any(LocalDateTime.class))).thenReturn(List.of());

            appEventService.getRecent(24, "all", "all");

            verify(repo).findRecent(any(LocalDateTime.class));
        }

        @Test
        @DisplayName("filters by category only")
        void categoryFilter() {
            when(repo.findRecentByCategory(any(LocalDateTime.class), eq("sync")))
                    .thenReturn(List.of());

            appEventService.getRecent(24, "sync", null);

            verify(repo).findRecentByCategory(any(LocalDateTime.class), eq("sync"));
        }

        @Test
        @DisplayName("filters by level only")
        void levelFilter() {
            when(repo.findRecentByLevel(any(LocalDateTime.class), eq("ERROR")))
                    .thenReturn(List.of());

            appEventService.getRecent(24, null, "ERROR");

            verify(repo).findRecentByLevel(any(LocalDateTime.class), eq("ERROR"));
        }

        @Test
        @DisplayName("filters by both category and level")
        void categoryAndLevelFilter() {
            when(repo.findRecentByCategoryAndLevel(any(LocalDateTime.class), eq("sync"), eq("WARN")))
                    .thenReturn(List.of());

            appEventService.getRecent(6, "sync", "WARN");

            verify(repo).findRecentByCategoryAndLevel(any(LocalDateTime.class), eq("sync"), eq("WARN"));
        }

        @Test
        @DisplayName("handles empty strings as null filters")
        void emptyStringAsNull() {
            when(repo.findRecent(any(LocalDateTime.class))).thenReturn(List.of());

            appEventService.getRecent(24, "", "");

            verify(repo).findRecent(any(LocalDateTime.class));
        }
    }

    @Nested
    @DisplayName("cleanup")
    class Cleanup {

        @Test
        @DisplayName("deletes events older than N days")
        void deletesOldEvents() {
            when(repo.deleteByTimestampBefore(any(LocalDateTime.class))).thenReturn(42L);

            long deleted = appEventService.cleanup(30);

            assertEquals(42L, deleted);
            verify(repo).deleteByTimestampBefore(any(LocalDateTime.class));
        }
    }
}
