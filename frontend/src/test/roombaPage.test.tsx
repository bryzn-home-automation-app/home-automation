import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Roomba from '../pages/Roomba';
import * as roombaApi from '../api/roomba';

// The Roomba page with its APIs mocked: the keys stay admin-only, members get the state and
// a reason, a failed load says so, the run list opens the kit dialog, and the view is a tab.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const state = {
  role: 'ADMIN' as 'ADMIN' | 'USER',
  runsFail: false,
  status: {} as Record<string, unknown>,
  /** What the commands list returns (newest first). */
  commands: [] as Array<Record<string, unknown>>,
  /** The stored position, however old (GET /roomba/position/last). */
  lastPosition: null as Record<string, unknown> | null,
  /** The robot's schedules and the skipped cleans. */
  schedules: [] as Array<Record<string, unknown>>,
  skips: [] as Array<Record<string, unknown>>,
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 1, username: 'bryan', displayName: 'Bryan', role: state.role },
    isAdmin: state.role === 'ADMIN',
    isGuest: false,
  }),
}));

const docked = {
  robotId: 'r1', name: 'Rosie', batteryPct: 100, phase: 'charge', cycle: 'none', error: 0, errorText: null, running: false,
  binPresent: true, tankPresent: true, currentMissionId: null, missionStart: null, sqft: null, runtimeMinutes: null,
  dockState: 301, dockError: 0, dockText: 'Ready', notReady: 0, initiator: null, detectedPad: 'padPlate', chargeCycles: 412,
  chargeErrors: 0, faultText: null, wear: { nStuck: 23 }, lifetimeMissions: 188, lifetimeRunMinutes: 19110, mapVersion: null,
  online: true, needsAttention: false, attentionReasons: [], updatedAt: new Date().toISOString(),
};

const run = {
  id: 7, startedAt: '2026-11-08T16:05:00Z', completedAt: '2026-11-08T21:44:00Z', durationMinutes: 339, squareFeet: 1124,
  missionId: 'M1', missionNumber: 186, error: 0, errorText: null, initiator: 'schedule', cycle: 'clean', source: 'cloud',
  chargeMinutes: 163, evacuations: 2, doneCode: 'ok', rooms: ['Living Room', 'Kitchen'], settings: null, verified: true,
  status: 'COMPLETED',
};

vi.mock('../api/roomba', () => ({
  fetchRoombaStatus: vi.fn(async () => ({ ...docked, ...state.status })),
  fetchRoombaRuns: async () => {
    if (state.runsFail) throw new Error('down');
    return [run, { ...run, id: 8, startedAt: '2026-11-05T15:00:00Z', status: 'STUCK' }];
  },
  fetchRoombaMap: async () => null,
  fetchRoombaDevice: async () => null,
  fetchRoombaParts: async () => [],
  fetchRoombaCommands: async () => state.commands,
  fetchRoombaPosition: async () => null,
  fetchRoombaLastPosition: async () => state.lastPosition,
  fetchRoombaCoverage: async () => null,
  fetchRoombaNativeSchedules: async () => state.schedules,
  refreshRoombaNativeSchedules: async () => ({}),
  fetchRoombaScheduleSkips: async () => state.skips,
  skipRoombaClean: vi.fn(async (householdScheduleId: string, date: string) => ({ id: 9, householdScheduleId, date })),
  undoRoombaSkip: vi.fn(async (id: number) => ({ id })),
  sendRoombaCommand: vi.fn(async (command: string) => ({ id: 1, command, status: 'PENDING' })),
  cleanRoombaRooms: vi.fn(),
  cleanRoombaRoom: vi.fn(),
  renameRoombaRoom: vi.fn(),
  splitRoombaRoom: vi.fn(),
  mergeRoombaRooms: vi.fn(),
}));

function renderPage(path = '/roomba') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Roomba />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Roomba page', () => {
  beforeEach(() => {
    state.role = 'ADMIN';
    state.runsFail = false;
    state.status = {};
    state.commands = [];
    state.lastPosition = null;
    state.schedules = [];
    state.skips = [];
    vi.mocked(roombaApi.sendRoombaCommand).mockClear();
    vi.mocked(roombaApi.fetchRoombaStatus).mockClear();
  });

  it('gives an admin the Clean key, which opens the kit dialog', async () => {
    renderPage();
    expect(await screen.findByText('Rosie is docked and ready.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Clean$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a clean' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('shows a member the state and why there are no keys', async () => {
    state.role = 'USER';
    renderPage();
    expect(await screen.findByText('Rosie is docked and ready.')).toBeTruthy();
    expect(screen.getByText(/Only an admin can start or stop the robot/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Clean$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send home/ })).toBeNull();
  });

  it('never calls a stale clean live (B-138)', async () => {
    state.status = { phase: 'run', cycle: 'clean', running: true, online: false, updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() };
    renderPage();
    expect(await screen.findByText(/Rosie hasn't checked in since/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pause$/ })).toBeNull();
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('says where a robot that stopped away from its dock was last seen, and not once it is docked', async () => {
    // Nov 12: the mission ran out with the robot in the living room; its stored phase is "stop".
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    state.lastPosition = { robotId: 'r1', x: -5.55, y: 4.63, theta: -2.42, updatedAt: tenMinutesAgo };
    state.status = { phase: 'stop', cycle: 'none', batteryPct: 11 };
    const { unmount } = renderPage();
    expect(await screen.findByText('Rosie is stopped away from the dock.')).toBeTruthy();
    expect(screen.getByText(/^Last seen (yesterday )?at \d{1,2}:\d\d/)).toBeTruthy();
    unmount();

    state.status = {};
    renderPage();
    expect(await screen.findByText('Rosie is docked and ready.')).toBeTruthy();
    expect(screen.queryByText(/Last seen/)).toBeNull();
  });

  it("says the dock's clean-water tank is empty, with its code, and lights the dock lamp (Nov 13)", async () => {
    state.status = {
      needsAttention: true,
      attentionReasons: ["The dock's clean-water tank is empty", 'picea unknown fault code:717'],
      faultText: 'picea unknown fault code:717',
      dockIssue: { kind: 'clean_water_empty', code: 671, since: new Date(Date.now() - 3_600_000).toISOString() },
    };
    const { unmount } = renderPage();
    expect(await screen.findByText("The dock's clean-water tank is empty.")).toBeTruthy();
    expect(screen.getByText(/Refill it and Rosie can mop again\./)).toBeTruthy();
    expect(screen.getByText('Dock code 671')).toBeTruthy();
    expect(screen.getByText('Dock: clean water empty')).toBeTruthy();
    expect(screen.queryByText(/docked and ready/)).toBeNull();
    unmount();

    state.status = {};
    renderPage();
    expect(await screen.findByText('Rosie is docked and ready.')).toBeTruthy();
    expect(screen.getByText('Dock OK')).toBeTruthy();
  });

  it('lists runs by their visible words and opens the run dialog (B-132)', async () => {
    renderPage();
    const list = await screen.findByRole('region', { name: 'Recent cleans' });
    const rows = await within(list).findAllByRole('button');
    expect(rows[1].textContent).toMatch(/Stuck/);
    fireEvent.click(rows[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Docked to recharge')).toBeTruthy();
  });

  it('charts the time per clean under the recent cleans, loaded after the page', async () => {
    renderPage();
    const chart = await screen.findByRole('region', { name: 'Time per clean' });
    // The Nov 8 run: 339 min start to finish, 163 of them recharging.
    await waitFor(() =>
      expect(chart.querySelector('.fp-chart-readout[aria-live]')?.textContent?.replace(/ /g, ' ')).toMatch(/Cleaning 2 hr 56 minRecharging 2 hr 43 min1,124 sq ft$/),
    );
  });

  it('says a failed load failed, with Try again (B-005)', async () => {
    state.runsFail = true;
    renderPage();
    expect(await screen.findByText("Couldn't load the recent cleans")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0);
  });

  it('opens the Maintenance view from the URL, with lifetime counters named once (B-128, B-129)', async () => {
    renderPage('/roomba?view=maintenance');
    const tab = await screen.findByRole('tab', { name: /Maintenance/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(screen.getByText('Powered on')).toBeTruthy());
    expect(screen.getByText('Pad plate only (no pad)')).toBeTruthy();
  });

  // ─── The admin keys ─────────────────────────────────────────────────
  const cmdRow = (over: Record<string, unknown>) => ({
    id: 1, command: 'pause', arg: null, status: 'PENDING', detail: null, requestedBy: 'bryan',
    createdAt: new Date().toISOString(), processedAt: null, ...over,
  });
  const mission = { cycle: 'clean', sqft: 300, runtimeMinutes: 20 };

  it.each([
    ['cleaning', { ...mission, phase: 'run', running: true }, 'Pause'],
    ['emptying the bin mid-clean', { ...mission, phase: 'evac', running: true }, 'Pause'],
    ['recharging mid-clean', { ...mission, phase: 'charge', running: false }, 'Pause'],
    ['heading home mid-clean', { ...mission, phase: 'hmMidMsn', running: false }, 'Pause'],
    ['paused', { ...mission, phase: 'stop', running: false }, 'Resume'],
    ['docked', {}, 'Clean'],
  ])('leads with the right key while %s', async (_what, status, key) => {
    state.status = status;
    renderPage();
    expect(await screen.findByRole('button', { name: new RegExp(`^${key}$`) })).toBeTruthy();
    for (const other of ['Pause', 'Resume', 'Clean'].filter((k) => k !== key)) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${other}$`) })).toBeNull();
    }
  });

  it('gives a member no keys mid-clean either', async () => {
    state.role = 'USER';
    state.status = { ...mission, phase: 'evac', running: true };
    renderPage();
    expect(await screen.findByText(/Only an admin can start or stop the robot/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pause$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Stop here/ })).toBeNull();
  });

  it('shows a failed command as a failure, with the reason', async () => {
    state.status = { ...mission, phase: 'run', running: true };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pause$/ }));
    state.commands = [cmdRow({ status: 'FAILED', detail: 'robot unreachable' })];
    const notice = await screen.findByText('Pause failed: robot unreachable', {}, { timeout: 5000 });
    expect(notice.closest('.fp-notice')?.className).toMatch(/fp-notice--problem/);
    expect(screen.queryByText(/sent to the robot/i)).toBeNull();
    // A failure frees the key to try again.
    expect(screen.getByRole('button', { name: /^Pause$/ }).getAttribute('aria-busy')).toBeNull();
  });

  it('says "sent to the robot", not that it worked, once the poller hands it over', async () => {
    state.status = { ...mission, phase: 'run', running: true };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pause$/ }));
    state.commands = [cmdRow({ status: 'OK', detail: 'accepted by broker' })];
    const notice = await screen.findByText(/Pause: sent to the robot\. The status above shows when it acts\./, {}, { timeout: 5000 });
    expect(notice.closest('.fp-notice')?.className).toMatch(/fp-notice--ok/);
  });

  it('holds the same key while the command is on its way, but not the others', async () => {
    state.status = { ...mission, phase: 'run', running: true };
    state.commands = [];
    renderPage();
    const pause = await screen.findByRole('button', { name: /^Pause$/ });
    fireEvent.click(pause);
    state.commands = [cmdRow({ status: 'SENT' })];
    await waitFor(() => expect(pause.getAttribute('aria-busy')).toBe('true'));
    // SENT: the poller has sent it and is reading the robot back.
    expect(await screen.findByText('Sent. Waiting for the robot…', {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(pause);
    fireEvent.click(pause);
    expect(roombaApi.sendRoombaCommand).toHaveBeenCalledTimes(1);
    const find = screen.getByRole('button', { name: /Find it/ });
    await waitFor(() => expect((find as HTMLButtonElement).disabled).toBe(false));
    expect(find.getAttribute('aria-busy')).toBeNull();
  });

  it('holds the key for as long as the poller is still on it, then says there is no word after 90 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.status = { ...mission, phase: 'run', running: true };
      renderPage();
      const pause = await screen.findByRole('button', { name: /^Pause$/ });
      fireEvent.click(pause);
      state.commands = [cmdRow({ status: 'SENT' })];
      // Past the old 30 s release: a resent pause can take ~35 s, and a second press then would
      // supersede the first.
      await vi.advanceTimersByTimeAsync(40_000);
      expect(pause.getAttribute('aria-busy')).toBe('true');
      expect(screen.queryByText('No word from the robot yet')).toBeNull();
      await vi.advanceTimersByTimeAsync(55_000);
      expect(await screen.findByText('No word from the robot yet')).toBeTruthy();
      expect(pause.getAttribute('aria-busy')).toBeNull();
      // A late outcome still shows.
      state.commands = [cmdRow({ status: 'FAILED', detail: 'the robot didn\'t react' })];
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await screen.findByText("Pause failed: the robot didn't react")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Skipping a scheduled clean ─────────────────────────────────────
  // Mon Nov 16 2026, 8:00 AM at home: Mon + Fri and Tue – Thu schedules, both at 9:00 AM.
  const schedule = (id: string, days: number[], enabled = true) => ({
    householdScheduleId: id, name: 'Regular Schedule', frequency: 'WEEKLY', days, hour: 9, minute: 0, enabled,
    roomCount: 6, operatingModes: [2], updatedAt: '2026-10-08T14:30:45Z',
  });
  const skipRow = (over: Record<string, unknown>) => ({
    id: 5, householdScheduleId: 'hh_TUETHU', scheduleId: 'hh_TUETHU', date: '2026-11-17', hour: 9, minute: 0,
    scheduledFor: '2026-11-17T15:00:00Z', restoreAfter: '2026-11-17T15:30:00Z', state: 'APPLIED', detail: null,
    lastError: null, undoRequested: false, requestedBy: 'user:1', createdAt: '2026-11-16T13:00:00Z',
    appliedAt: '2026-11-16T13:00:05Z', finishedAt: null, ...over,
  });
  const atHome = (iso: string) => vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(iso) });

  it("offers today's and tomorrow's clean by time, and skips the one pressed", async () => {
    atHome('2026-11-16T14:00:00Z');
    try {
      state.schedules = [schedule('hh_MONFRI', [1, 5]), schedule('hh_TUETHU', [2, 3, 4])];
      renderPage();
      expect(await screen.findByRole('button', { name: /^Skip today's 9:00\sAM clean$/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /^Skip tomorrow's 9:00\sAM clean$/ }));
      await waitFor(() => expect(roombaApi.skipRoombaClean).toHaveBeenCalledWith('hh_TUETHU', '2026-11-17'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says which clean is skipped and when the next one is, with an Undo for an admin', async () => {
    atHome('2026-11-17T02:00:00Z'); // Mon 8 PM
    try {
      state.schedules = [schedule('hh_MONFRI', [1, 5]), schedule('hh_TUETHU', [2, 3, 4], false)];
      state.skips = [skipRow({})];
      renderPage();
      const notice = (await screen.findByText("Tomorrow's 9:00 AM clean is skipped.")).closest('.fp-notice') as HTMLElement;
      expect(notice.textContent).toMatch(/Next clean Wednesday at 9:00\sAM\./);
      expect(notice.textContent).toMatch(/The Tue – Thu schedule is off in the iRobot app until tomorrow at 9:30\sAM/);
      // The readout passes over the skipped clean; tomorrow's key is gone, nothing left today.
      expect(screen.queryByRole('button', { name: /Skip tomorrow/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Skip today/ })).toBeNull();
      fireEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(roombaApi.undoRoombaSkip).toHaveBeenCalledWith(5));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a member what is skipped, without the keys', async () => {
    atHome('2026-11-17T02:00:00Z');
    try {
      state.role = 'USER';
      state.schedules = [schedule('hh_MONFRI', [1, 5]), schedule('hh_TUETHU', [2, 3, 4], false)];
      state.skips = [skipRow({})];
      renderPage();
      expect(await screen.findByText("Tomorrow's 9:00 AM clean is skipped.")).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Skip / })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a skipped clean and an empty tank: the verdict, the skip and the Next clean tile agree', async () => {
    atHome('2026-11-13T16:42:00Z'); // Fri 10:42 AM, Nov 13: the tank is empty
    try {
      state.status = {
        needsAttention: true,
        attentionReasons: ["The dock's clean-water tank is empty"],
        dockIssue: { kind: 'clean_water_empty', code: 671, since: '2026-11-13T15:01:00Z' },
      };
      // Monday's vacuum and mop is skipped, so the next clean is Tuesday's vacuum: nothing to wait on.
      const mopping = { ...schedule('hh_MONFRI', [1, 5], false), operatingModes: [6] };
      state.schedules = [mopping, schedule('hh_TUETHU', [2, 3, 4])];
      state.skips = [skipRow({
        householdScheduleId: 'hh_MONFRI', scheduleId: 'hh_MONFRI', date: '2026-11-16',
        scheduledFor: '2026-11-16T15:00:00Z', restoreAfter: '2026-11-16T15:30:00Z',
      })];
      const { unmount } = renderPage();
      expect(await screen.findByText("The dock's clean-water tank is empty.")).toBeTruthy();
      const notice = (await screen.findByText("Monday's 9:00 AM clean is skipped.")).closest('.fp-notice') as HTMLElement;
      expect(notice.textContent).toMatch(/Next clean Tuesday at 9:00\sAM\./);
      expect(screen.getByText(/^Tue, Nov 17, Regular Schedule$/)).toBeTruthy();
      unmount();

      // Not skipped: Monday's clean mops, so the tile says it waits on the tank, with a heads-up lamp.
      state.schedules = [{ ...mopping, enabled: true }, schedule('hh_TUETHU', [2, 3, 4])];
      state.skips = [];
      renderPage();
      const note = await screen.findByText(/^Mon, Nov 16, once the clean-water tank is refilled$/);
      expect(note.closest('.fp-readout')?.querySelector('.fp-lamp')).toBeTruthy();
      expect(screen.getByText("The dock's clean-water tank is empty.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when a skip couldn't be made", async () => {
    atHome('2026-11-17T15:20:00Z'); // Tue 9:20 AM
    try {
      state.schedules = [schedule('hh_MONFRI', [1, 5]), schedule('hh_TUETHU', [2, 3, 4])];
      state.skips = [skipRow({ state: 'FAILED', detail: "The schedule couldn't be switched off before the clean was due, so it may have run." })];
      renderPage();
      const title = await screen.findByText("Couldn't skip today's 9:00 AM clean.");
      expect(title.closest('.fp-notice')?.className).toMatch(/fp-notice--problem/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the status right away and every second while the robot has not reacted, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.status = { ...mission, phase: 'run', running: true };
      renderPage();
      const pause = await screen.findByRole('button', { name: /^Pause$/ });
      const status = vi.mocked(roombaApi.fetchRoombaStatus);
      const before = status.mock.calls.length;
      fireEvent.click(pause);
      await waitFor(() => expect(status.mock.calls.length).toBe(before + 1));
      await vi.advanceTimersByTimeAsync(3_000);
      await waitFor(() => expect(status.mock.calls.length).toBeGreaterThanOrEqual(before + 4));
      // The robot pauses: the status moves, the row lands, and the fast re-reads stop.
      state.status = { ...mission, phase: 'stop', running: false };
      state.commands = [cmdRow({ status: 'OK', detail: 'the robot reacted 1.2 s after it was sent' })];
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await screen.findByRole('button', { name: /^Resume$/ })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(1_000);
      const settled = status.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(status.mock.calls.length).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});
