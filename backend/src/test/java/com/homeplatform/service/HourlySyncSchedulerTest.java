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
 * Backoff state machine for {@link HourlySyncScheduler}. The DB/date/process
 * touch points are stubbed via package-private seams (same pattern as
 * {@code AlertEngineTest}) so we exercise pure scheduling logic without Postgres,
 * a clock, or a child {@code node} process.
 */
class HourlySyncSchedulerTest {

    /** Test double: stubs the DB, clock, and process seams; counts scans/spawns. */
    static class TestScheduler extends HourlySyncScheduler {
        LocalDate today = LocalDate.of(2026, 8, 22);  // "yesterday" = 08-21
        boolean everythingComplete = true;
        int scanCalls = 0;
        int spawnCalls = 0;

        TestScheduler(AppEventService events, AlertEngine alerts) {
            super(mock(DataSource.class), events, alerts);
        }

        @Override
        LocalDate today() {
            return today;
        }

        @Override
        Optional<LocalDate> findEarliestIncompleteDay(LocalDate yesterday, int windowDays) {
            scanCalls++;
            return everythingComplete ? Optional.empty() : Optional.of(yesterday);
        }

        @Override
        DaySnapshot readDay(String date) {
            return new DaySnapshot(24, 24, 60.0);
        }

        @Override
        int spawn(List<String> command, StringBuilder output) {
            spawnCalls++;
            output.append("ok\n");
            return 0;
        }
    }

    private TestScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new TestScheduler(mock(AppEventService.class), mock(AlertEngine.class));
    }

    @Test
    @DisplayName("stands down after two consecutive complete checks and stops re-scanning")
    void standsDownAfterConfirmations() {
        scheduler.everythingComplete = true;

        scheduler.checkAndSync();   // 1st complete check — one confirmation
        scheduler.checkAndSync();   // 2nd complete check — reaches the threshold, stands down
        assertEquals(2, scheduler.scanCalls, "should scan on the first two ticks");

        // Further ticks the same day must short-circuit before scanning or logging.
        scheduler.checkAndSync();
        scheduler.checkAndSync();
        assertEquals(2, scheduler.scanCalls, "must not re-scan a date it already stood down for");
        assertEquals(0, scheduler.spawnCalls, "a complete window never spawns the sync");
    }

    @Test
    @DisplayName("day rollover clears the stand-down and scanning resumes")
    void rolloverResumesScanning() {
        scheduler.everythingComplete = true;
        scheduler.checkAndSync();
        scheduler.checkAndSync();   // stood down for 08-21
        assertEquals(2, scheduler.scanCalls);

        scheduler.today = scheduler.today.plusDays(1);  // new "yesterday" = 08-22
        scheduler.checkAndSync();
        assertEquals(3, scheduler.scanCalls, "rollover should scan the new day again");
    }

    @Test
    @DisplayName("an incomplete day syncs, resets the streak, and delays stand-down")
    void incompleteResetsStreak() {
        // One clean scan first (confirmation streak = 1).
        scheduler.everythingComplete = true;
        scheduler.checkAndSync();
        assertEquals(1, scheduler.scanCalls);

        // A gap appears: it syncs and resets the streak.
        scheduler.everythingComplete = false;
        scheduler.checkAndSync();
        assertEquals(1, scheduler.spawnCalls, "an incomplete day should trigger a sync");

        // Complete again: because the streak reset, it needs the full confirmation
        // count once more before standing down — it can't shortcut off the stale streak.
        scheduler.everythingComplete = true;
        scheduler.checkAndSync();   // streak = 1, still scanning
        int scansBeforeStandDown = scheduler.scanCalls;
        scheduler.checkAndSync();   // streak = 2, stands down
        scheduler.checkAndSync();   // short-circuited, no new scan
        assertEquals(scansBeforeStandDown + 1, scheduler.scanCalls,
                "should re-scan exactly once more, then stand down");
    }
}
