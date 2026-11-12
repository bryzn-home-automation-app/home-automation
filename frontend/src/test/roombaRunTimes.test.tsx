import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RoombaRunTimes from '../components/RoombaRunTimes';
import type { RoombaRun } from '../types';

// The Time per clean chart on the Roomba Overview: the readout names the latest clean in words
// and units, arrow keys and a finger move it, odd runs are handled, and the states say what's coming.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NOW = new Date('2026-11-12T18:00:00Z');

let nextId = 1;
function run(startedAt: string, over: Partial<RoombaRun> = {}): RoombaRun {
  return {
    id: nextId++, startedAt, completedAt: null, durationMinutes: 383, squareFeet: 1610, status: 'COMPLETED',
    missionId: null, missionNumber: null, error: 0, errorText: null, initiator: 'cloud', cycle: null,
    source: 'irobot-history', chargeMinutes: 201, pauseMinutes: 0, evacuations: 6, doneCode: 'ok', rooms: [],
    settings: null, verified: true, ...over,
  };
}

// Newest first, like GET /api/roomba/runs: the real mix of the last few weeks.
const RUNS: RoombaRun[] = [
  run('2026-11-11T15:00:17Z', { durationMinutes: 72, chargeMinutes: 0, pauseMinutes: 41, squareFeet: 232, status: 'CANCELLED' }),
  run('2026-11-10T17:30:01Z', { durationMinutes: 169, chargeMinutes: 0, pauseMinutes: 55, squareFeet: 748 }),
  run('2026-11-10T15:00:16Z', { durationMinutes: 106, chargeMinutes: 0, squareFeet: 138, status: 'STUCK', error: 9, errorText: 'Bumper is stuck' }),
  run('2026-11-06T15:00:18Z', { durationMinutes: 419, chargeMinutes: 203, pauseMinutes: 30, squareFeet: 1555 }),
  run('2026-11-05T15:00:13Z'),
  run('2026-10-29T14:00:16Z', {
    durationMinutes: 135, chargeMinutes: 0, squareFeet: 1169, status: 'STUCK', error: 1010,
    errorText: "Rosie couldn't return to Dock. Move and place it on the Dock for charging.",
  }),
  run('2026-09-26T17:53:12Z', { durationMinutes: 2, chargeMinutes: 0, squareFeet: 11, status: 'CANCELLED' }),
  run('2026-09-26T17:00:00Z', { durationMinutes: 653, chargeMinutes: 390, squareFeet: 1529 }),
];

const query = (data: RoombaRun[] | undefined, isError = false) => ({ data, isError, refetch: () => {} });

function renderChart(data: RoombaRun[] | undefined, opts: { cleaningNow?: boolean; isError?: boolean } = {}) {
  return render(<RoombaRunTimes query={query(data, opts.isError)} cleaningNow={!!opts.cleaningNow} now={NOW} />);
}

/** The visible readout line (the hidden copies only hold its height). */
const readout = () => ({ textContent: document.querySelector('.fp-chart-readout[aria-live]')!.textContent!.replace(/ /g, ' ') });
const words = (el: Element) => el.textContent!.replace(/ /g, ' ');
const plot = () => screen.getByRole('group', { name: /Use the arrow keys/ });

describe('Time per clean', () => {
  it('reads the latest clean in words and units, with the headline figures', () => {
    renderChart(RUNS);
    expect(screen.getByRole('region', { name: 'Time per clean' })).toBeTruthy();
    // Yesterday's clean was stopped early after 31 min out and 41 min paused.
    expect(readout().textContent).toBe('YesterdayStopped earlyOff the dock 31 minPaused 41 min232 sq ft');
    // Finished: 114, 186, 182 and 263 min of cleaning; three of the four recharged.
    expect(words(screen.getByText('Typical clean').closest('.fp-readout')!)).toBe('Typical clean3hr 4minCleaning time');
    expect(words(screen.getByText('Recharged').closest('.fp-readout')!)).toBe('Recharged3of 4Finished cleans');
    expect(screen.getByText(/1 false start under 5 min not shown/)).toBeTruthy();
  });

  it('moves the readout with the arrow keys, naming how a run ended', () => {
    renderChart(RUNS);
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' });
    expect(readout().textContent).toBe('Tue, Nov 10Cleaning 1 hr 54 minPaused 55 min748 sq ft');
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' });
    expect(readout().textContent).toBe('Tue, Nov 10Stuck: Bumper is stuckOff the dock 1 hr 46 min138 sq ft');
    fireEvent.keyDown(plot(), { key: 'Home' });
    expect(readout().textContent).toBe('Sat, Sep 26Cleaning 4 hr 23 minRecharging 6 hr 30 min1,529 sq ft');
    fireEvent.keyDown(plot(), { key: 'ArrowRight' });
    // iRobot's long error title is cut to its first sentence.
    expect(readout().textContent).toBe("Thu, Oct 29Stuck: Rosie couldn't return to DockOff the dock 2 hr 15 min1,169 sq ft");
    fireEvent.keyDown(plot(), { key: 'End' });
    expect(readout().textContent).toMatch(/^Yesterday/);
  });

  it('reads the bar under a finger and keeps it after the finger lifts', () => {
    renderChart(RUNS);
    const el = plot();
    // 46 px of y-axis, 7 bars of 40 px each, then the 18 px right margin.
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 46 + 280 + 18, height: 170, right: 344, bottom: 170, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(el, { clientX: 46 + 3 * 40 + 20, pointerType: 'touch' });
    expect(readout().textContent).toMatch(/^Fri, Nov 6Cleaning 3 hr 6 minRecharging 3 hr 23 minPaused 30 min1,555 sq ft$/);
    fireEvent.pointerLeave(el, { pointerType: 'touch' });
    expect(readout().textContent).toMatch(/^Fri, Nov 6/);
    fireEvent.pointerLeave(el, { pointerType: 'mouse' });
    expect(readout().textContent).toMatch(/^Yesterday/);
  });

  it('says a clean under way or still unconfirmed is coming, and leaves it off', () => {
    const pending = run('2026-11-12T15:00:15Z', { verified: false, source: 'roombapy-prime', chargeMinutes: null, pauseMinutes: null, durationMinutes: 120, status: 'CANCELLED' });
    const { unmount } = renderChart([pending, ...RUNS]);
    expect(screen.getByText(/The latest clean shows here once iRobot confirms its times/)).toBeTruthy();
    expect(readout().textContent).toMatch(/^Yesterday/);
    unmount();
    renderChart([pending, ...RUNS], { cleaningNow: true });
    expect(screen.getByText(/A clean is under way; it shows here once it ends/)).toBeTruthy();
    expect(screen.queryByText(/The latest clean shows here/)).toBeNull();
  });

  it('charts a single clean, without calling one clean typical', () => {
    renderChart([RUNS[3]]);
    expect(screen.getByText('Each clean, start to finish')).toBeTruthy();
    expect(readout().textContent).toMatch(/^Fri, Nov 6Cleaning 3 hr 6 min/);
    expect(words(screen.getByText('Recharged').closest('.fp-readout')!)).toMatch(/1of 1/);
    expect(words(screen.getByText('Typical clean').closest('.fp-readout')!)).toBe('Typical clean—Shown after 3 finished cleans');
    expect(screen.queryByText('Typical cleaning')).toBeNull();
  });

  it('has nothing to chart with no confirmed runs, and no figures with nothing finished', () => {
    const { unmount } = renderChart([]);
    expect(screen.getByText('Nothing to chart yet')).toBeTruthy();
    expect(screen.getByText(/shows here once iRobot confirms the run/)).toBeTruthy();
    unmount();
    renderChart([RUNS[2]]);
    expect(words(screen.getByText('Recharged').closest('.fp-readout')!)).toBe('Recharged—Counted once one finishes');
  });

  it('says once that a clean still to be confirmed is coming when it is the only one', () => {
    renderChart([run('2026-11-12T15:00:15Z', { verified: false, chargeMinutes: null, pauseMinutes: null })]);
    expect(screen.getByText('Nothing to chart yet')).toBeTruthy();
    expect(screen.getAllByText(/once iRobot confirms/)).toHaveLength(1);
    expect(screen.getByText(/The latest clean shows here/)).toBeTruthy();
  });

  it('waits on the run list without a second error of its own', () => {
    const { unmount } = renderChart(undefined);
    expect(document.querySelector('.fp-skel')).toBeTruthy();
    unmount();
    renderChart(undefined, { isError: true });
    expect(screen.getByText('The chart shows once the recent cleans load.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });
});
