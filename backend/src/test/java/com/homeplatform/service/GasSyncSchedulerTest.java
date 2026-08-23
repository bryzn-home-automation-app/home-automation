package com.homeplatform.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Output parsing + the "only log an app_event when something happened" policy
 * for {@link GasSyncScheduler}. The child process is stubbed via the spawn seam.
 */
class GasSyncSchedulerTest {

    /** Test double: stubs the child process output + exit code. */
    static class TestScheduler extends GasSyncScheduler {
        String out = "";
        int exit = 0;

        TestScheduler(AppEventService events) {
            super(events);
        }

        @Override
        int spawn(List<String> command, StringBuilder output) {
            output.append(out);
            return exit;
        }
    }

    @Test
    void parseWrittenReadsTheHighestCount() {
        assertEquals(3, GasSyncScheduler.parseWritten(
                "── gas (monthly) — 3 billing month(s) · 3 written\nStatus: Success · 3 row(s) written"));
        assertEquals(0, GasSyncScheduler.parseWritten("── gas (monthly) — 0 records (no gas usage posted yet)"));
        assertEquals(0, GasSyncScheduler.parseWritten(null));
        assertEquals(1, GasSyncScheduler.parseWritten("· 1 written"));
    }

    @Test
    void logsAnInfoEventWhenRowsWereWritten() {
        AppEventService events = mock(AppEventService.class);
        TestScheduler s = new TestScheduler(events);
        s.out = "── gas (monthly) — 1 billing month(s) · 1 written\n";
        s.exit = 0;

        s.runGasSync();

        verify(events).log(eq("sync"), eq("INFO"), eq("GasSyncScheduler"), anyString(), anyString());
        verify(events, never()).error(any(), any(), any(), any());
    }

    @Test
    void staysSilentInAppEventsWhenNothingWasWritten() {
        AppEventService events = mock(AppEventService.class);
        TestScheduler s = new TestScheduler(events);
        s.out = "── gas (monthly) — 0 records (no gas usage posted yet)\n";
        s.exit = 0;

        s.runGasSync();

        // A quiet no-op day must not spam the Debug Dashboard.
        verifyNoInteractions(events);
    }

    @Test
    void logsAWarnEventOnNonZeroExit() {
        AppEventService events = mock(AppEventService.class);
        TestScheduler s = new TestScheduler(events);
        s.out = "── gas (monthly) — error: boom\n";
        s.exit = 1;

        s.runGasSync();

        verify(events).log(eq("sync"), eq("WARN"), eq("GasSyncScheduler"), anyString(), anyString());
    }
}
