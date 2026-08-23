package com.homeplatform.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Backoff state machine for {@link DailySyncScheduler}. The DB/date/process
 * touch points are stubbed via package-private seams (same pattern as
 * {@code HourlySyncSchedulerTest}) so we exercise pure scheduling logic without
 * Postgres, a clock, or a child {@code node} process.
 */
class DailySyncSchedulerTest {

    /** Test double: stubs the DB, clock, and process seams; counts scans/syncs. */
    static class TestScheduler extends DailySyncScheduler {
        LocalDate today = LocalDate.of(2026, 8, 22);  // "yesterday" = 08-21
        boolean everythingPopulated = true;
        int scanCalls = 0;
        int syncCalls = 0;

        TestScheduler(AppEventService events, AlertEngine alerts) {
            super(mock(DataSource.class), events, alerts);
        }

        @Override
        LocalDate today() {
            return today;
        }

        @Override
        Optional<LocalDate> findEarliestMissingDay(LocalDate yesterday, int windowDays) {
            scanCalls++;
            return everythingPopulated ? Optional.empty() : Optional.of(yesterday);
        }

        @Override
        void runSync(List<String> command, String label) {
            syncCalls++;  // never spawn a real process in tests
        }
    }

    private TestScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new TestScheduler(mock(AppEventService.class), mock(AlertEngine.class));
    }

    @Test
    @DisplayName("stands down after two consecutive populated checks and stops re-scanning")
    void standsDownAfterConfirmations() {
        scheduler.everythingPopulated = true;

        scheduler.runDailySync();   // 1st populated check — one confirmation
        scheduler.runDailySync();   // 2nd populated check — reaches the threshold, stands down
        assertEquals(2, scheduler.scanCalls, "should scan on the first two ticks");

        // Further ticks the same day must short-circuit before scanning or logging.
        scheduler.runDailySync();
        scheduler.runDailySync();
        assertEquals(2, scheduler.scanCalls, "must not re-scan a date it already stood down for");
        assertEquals(0, scheduler.syncCalls, "a populated window never spawns the sync");
    }

    @Test
    @DisplayName("day rollover clears the stand-down and scanning resumes")
    void rolloverResumesScanning() {
        scheduler.everythingPopulated = true;
        scheduler.runDailySync();
        scheduler.runDailySync();   // stood down for 08-21
        assertEquals(2, scheduler.scanCalls);

        scheduler.today = scheduler.today.plusDays(1);  // new "yesterday" = 08-22
        scheduler.runDailySync();
        assertEquals(3, scheduler.scanCalls, "rollover should scan the new day again");
    }

    @Test
    @DisplayName("a missing day syncs, resets the streak, and delays stand-down")
    void missingResetsStreak() {
        // One clean scan first (confirmation streak = 1).
        scheduler.everythingPopulated = true;
        scheduler.runDailySync();
        assertEquals(1, scheduler.scanCalls);

        // A gap appears: it syncs and resets the streak.
        scheduler.everythingPopulated = false;
        scheduler.runDailySync();
        assertEquals(1, scheduler.syncCalls, "a missing day should trigger a sync");

        // Populated again: because the streak reset, it needs the full confirmation
        // count once more before standing down — it can't shortcut off the stale streak.
        scheduler.everythingPopulated = true;
        scheduler.runDailySync();   // streak = 1, still scanning
        int scansBeforeStandDown = scheduler.scanCalls;
        scheduler.runDailySync();   // streak = 2, stands down
        scheduler.runDailySync();   // short-circuited, no new scan
        assertEquals(scansBeforeStandDown + 1, scheduler.scanCalls,
                "should re-scan exactly once more, then stand down");
    }
}
