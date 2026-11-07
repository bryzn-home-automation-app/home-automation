import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HostHealth, HostHistory, HostSnapshot } from '../types';
import { bits, bytes, duration, powerEvents, processLabel, restartCause, since } from '../utils/host';

vi.mock('../api/host', () => ({
  fetchHostHealth: vi.fn(),
  fetchHostHistory: vi.fn(),
}));

import * as hostApi from '../api/host';
import NucHealth from '../pages/admin/NucHealth';

const now = new Date();
const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();

const SNAPSHOT: HostSnapshot = {
  collectedAt: iso(20_000),
  intervalSeconds: 60,
  host: { name: 'NUC', model: 'Intel(R) Client Systems NUC10i3FNH', os: 'Microsoft Windows 11 Home', osBuild: '10.0.26200',
    cpuModel: 'Intel(R) Core(TM) i3-10110U CPU @ 2.10GHz', cores: 2, logicalProcessors: 4, bootTime: iso((2 * 24 + 7) * 3_600_000) },
  cpu: { usagePct: 24, clockMhz: 2093, maxClockMhz: 2592 },
  memory: { totalBytes: 16970715136, availableBytes: 4700983296, commitBytes: null, commitLimitBytes: null },
  disks: [{ name: 'C:', label: '', totalBytes: 254870024192, freeBytes: 64501051392, readBps: 377471, writeBps: 355819 }],
  physicalDisks: [{ name: 'SKHynix SSD', mediaType: 'SSD', sizeBytes: 256060514304, health: 'Healthy', temperatureC: 41, wearPct: 0, powerOnHours: null }],
  temperatures: [{ name: 'TZ.TZ00', celsius: 57.1 }],
  network: { adapter: 'Wi-Fi', description: 'Intel Wi-Fi 6', linkMbps: 1201, ip: '192.168.1.10', rxBps: 35788, txBps: 3561, tailscaleUp: true,
    wifi: { ssid: 'home', signalPct: 98, rssi: -32, band: '5 GHz', channel: '100', radio: '802.11ax', rxMbps: 1201, txMbps: 1201 } },
  power: { plan: 'Balanced', sleepAfterMinutes: 0, pendingReboot: false },
  events: [{ at: iso(2 * 24 * 3_600_000), id: 41, kind: 'unexpected', message: 'The system has rebooted without cleanly shutting down first.' }],
  topCpu: [{ name: 'vmmemWSL', count: 1, cpuPct: 10.4, memBytes: 7057063936 }, { name: 'svchost', count: 89, cpuPct: 3.2, memBytes: 1586520064 }],
  topMemory: [{ name: 'vmmemWSL', count: 1, cpuPct: 10.4, memBytes: 7057063936 }],
  docker: { ok: true, error: null, version: '29.7.2', cpus: 4, memTotalBytes: 7271218790, containers: [
    { name: 'homeplatform-backend', project: 'home-automation', image: 'backend', state: 'running', status: 'Up 3 hours (healthy)',
      health: 'healthy', cpuPct: 1.2, memBytes: 629145600, memLimitBytes: 7271218790 },
    { name: 'other-worker', project: 'other', image: 'x', state: 'exited', status: 'Exited (0) 2 days ago',
      health: null, cpuPct: null, memBytes: null, memLimitBytes: null },
  ] },
  agent: { version: 1, durationMs: 5400, sectionMs: null, errors: [] },
};

const HEALTH: HostHealth = {
  status: 'ONLINE',
  lastReportAt: SNAPSHOT.collectedAt,
  now: now.toISOString(),
  latest: SNAPSHOT,
  checks: [],
  app: { databaseBytes: 52428800, largestTables: [{ name: 'hourly_electric_usage', bytes: 10485760 }], heapUsedBytes: 300 * 1048576,
    heapMaxBytes: 1024 * 1048576, uptimeSeconds: 7200, threads: 60, samplesStored: 100 },
};

const HISTORY: HostHistory = {
  range: '24h', bucketMinutes: 5, from: iso(24 * 3_600_000), to: now.toISOString(), firstSampleAt: iso(30 * 60_000),
  points: [], summary: { samples: 30, cpuAvg: 18.2, cpuPeak: 61, memAvgPct: 71, memPeakPct: 74, cpuTempPeak: 63, rxBytes: 2e8, txBytes: 2e7 },
  gaps: [{ from: iso(3 * 3_600_000), to: iso(2 * 3_600_000), minutes: 60, restarted: true }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NucHealth /></QueryClientProvider>);
}

describe('NUC Health formatting', () => {
  it('writes sizes the way Windows does, and speeds in bits', () => {
    expect(bytes(64501051392)).toBe('60.1 GB');
    expect(bytes(254870024192)).toBe('237 GB');
    expect(bytes(629145600)).toBe('600 MB');
    expect(bytes(null)).toBe('—');
    expect(bits(35788)).toBe('286 kbps');
    expect(bits(2_500_000)).toBe('20.0 Mbps');
  });

  it('says how long in plain words', () => {
    expect(duration(21)).toBe('21 min');
    expect(duration(125)).toBe('2 h 5 min');
    expect(duration(43 * 60)).toBe('1 day 19 h');
    expect(duration(4 * 24 * 60)).toBe('4 days');
    expect(since(new Date(Date.now() - 55 * 3_600_000).toISOString())).toBe('2 days 7 h');
    expect(processLabel('vmmemWSL')).toBe("Docker's Linux VM");
    expect(processLabel('someapp')).toBe('someapp');
  });

  it('shows a crash once, and says who asked for a restart', () => {
    const crash = [
      { at: '2026-11-04T22:11:17Z', id: 6008, kind: 'unexpected', message: 'The previous system shutdown at 9:06:20 PM on 11/2/2026 was unexpected.' },
      { at: '2026-11-04T22:11:03Z', id: 41, kind: 'unexpected', message: 'The system has rebooted without cleanly shutting down first.' },
    ];
    expect(powerEvents(crash).map((e) => e.id)).toEqual([6008]);
    expect(restartCause('The process C:\\WINDOWS\\servicing\\TrustedInstaller.exe (NUC) has initiated the restart of computer NUC '
      + 'on behalf of user NT AUTHORITY\\SYSTEM for the following reason: Operating System: Upgrade (Planned) Reason Code: 0x80020003'))
      .toBe('By TrustedInstaller.exe · Operating System: Upgrade (Planned)');
    expect(restartCause('Something else')).toBeNull();
  });
});

describe('NUC Health page', () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the charts ask whether the screen is narrow.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.mocked(hostApi.fetchHostHealth).mockResolvedValue(HEALTH);
    vi.mocked(hostApi.fetchHostHistory).mockReset().mockResolvedValue(HISTORY);
  });

  it('shows the headline numbers, the containers and what is using the NUC', async () => {
    renderPage();
    expect(await screen.findByText('All good: nothing on the NUC needs attention.')).toBeInTheDocument();
    expect(screen.getByText('Reported just now')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
    expect(screen.getAllByText('Drive C:')).toHaveLength(2); // the tile and the Storage card
    expect(screen.getByText('60.1 GB free')).toBeInTheDocument();
    expect(screen.getByText('57 °C')).toBeInTheDocument();
    expect(screen.getByText('2 days 7 h')).toBeInTheDocument();
    expect(screen.getByText('homeplatform-backend')).toBeInTheDocument();
    expect(screen.getByText('Running · healthy')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 running · Docker 29.7.2 · 6.8 GB VM')).toBeInTheDocument();
    expect(screen.getAllByText("Docker's Linux VM").length).toBeGreaterThan(0);
    expect(screen.getByText('Froze or lost power')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument(); // sleeps after
  });

  it('lists problems worst first, in words as well as color', async () => {
    vi.mocked(hostApi.fetchHostHealth).mockResolvedValue({
      ...HEALTH,
      checks: [
        { key: 'docker', level: 'critical', title: "Docker isn't responding", detail: 'no answer from Docker within 15 s.' },
        { key: 'disk', level: 'warning', title: 'Drive C: is getting full', detail: '30.0 GB free of 237.4 GB.' },
      ],
    });
    renderPage();
    const card = (await screen.findByText('Needs attention')).closest('section')!;
    const items = within(card).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent("Critical: Docker isn't responding");
    expect(items[1]).toHaveTextContent('Warning: Drive C: is getting full');
  });

  it('says when Docker is not answering instead of listing containers', async () => {
    vi.mocked(hostApi.fetchHostHealth).mockResolvedValue({
      ...HEALTH,
      latest: { ...SNAPSHOT, docker: { ok: false, error: 'no answer from Docker within 15 s', version: null, cpus: null, memTotalBytes: null, containers: [] } },
    });
    renderPage();
    expect(await screen.findByText(/no answer from Docker within 15 s/)).toBeInTheDocument();
    expect(screen.queryByText('homeplatform-backend')).not.toBeInTheDocument();
  });

  it('shows how to set it up before the NUC has ever reported', async () => {
    vi.mocked(hostApi.fetchHostHealth).mockResolvedValue({ ...HEALTH, status: 'NOT_SET_UP', lastReportAt: null, latest: null });
    renderPage();
    expect(await screen.findByText("Set up the NUC's health monitor")).toBeInTheDocument();
    expect(screen.getByText('scripts\\install-host-metrics-task.cmd')).toBeInTheDocument();
    expect(hostApi.fetchHostHistory).not.toHaveBeenCalled();
  });

  it('flags a monitor that stopped reporting', async () => {
    vi.mocked(hostApi.fetchHostHealth).mockResolvedValue({ ...HEALTH, status: 'OFFLINE', lastReportAt: iso(3 * 3_600_000) });
    renderPage();
    expect(await screen.findByText('Monitor offline · last report 3 hr ago')).toBeInTheDocument();
    expect(screen.getByText(/^Last readings, from /)).toBeInTheDocument(); // the tiles aren't passed off as current
  });

  it("doesn't call the readings old while the monitor is reporting", async () => {
    renderPage();
    await screen.findByText('Reported just now');
    expect(screen.queryByText(/^Last readings, from /)).not.toBeInTheDocument();
  });

  it('switches the history range, and lists the quiet spells', async () => {
    renderPage();
    expect(await screen.findByText('Times it went quiet')).toBeInTheDocument();
    expect(screen.getByText(/1 h · it restarted/)).toBeInTheDocument();
    expect(screen.getByText(/avg 18% · busiest minute 61%/)).toBeInTheDocument();
    expect(hostApi.fetchHostHistory).toHaveBeenCalledWith('24h');
    fireEvent.click(screen.getByRole('button', { name: '7 d' }));
    await waitFor(() => expect(hostApi.fetchHostHistory).toHaveBeenCalledWith('7d'));
    expect(screen.getByRole('button', { name: '7 d' })).toHaveAttribute('aria-pressed', 'true');
  });
});
