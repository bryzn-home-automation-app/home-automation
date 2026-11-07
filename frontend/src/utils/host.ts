// Formatting for Admin → NUC Health. Sizes are binary but labelled GB/MB, as Windows shows
// them, so "60.1 GB free" here matches File Explorer.

const KB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "6.6 GB", "512 MB", "0 B". */
export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  let v = Math.max(0, n);
  let i = 0;
  while (v >= KB && i < UNITS.length - 1) {
    v /= KB;
    i++;
  }
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${UNITS[i]}`;
}

/** Network speed from bytes per second, in bits as ISPs quote it: "0.3 Mbps", "48 kbps". */
export function bits(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond)) return '—';
  const b = bytesPerSecond * 8;
  if (b >= 1e6) return `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} Mbps`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} kbps`;
  return `${Math.round(b)} bps`;
}

/** Disk throughput: "370 KB/s". */
export function perSecond(bytesPerSecond: number | null | undefined): string {
  return bytesPerSecond == null ? '—' : `${bytes(bytesPerSecond)}/s`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`;
}

/** Used share, 0–100, from a total and what's free. */
export function usedPct(total: number | null | undefined, free: number | null | undefined): number | null {
  return total && total > 0 && free != null ? (100 * (total - free)) / total : null;
}

/** "2 days 7 h", "5 h 12 min", "8 min". */
export function since(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 0) return '—';
  return duration(min);
}

/** Minutes as "43 h", "2 days 3 h", "21 min". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return minutes % 60 && h < 10 ? `${h} h ${minutes % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} day${d === 1 ? '' : 's'} ${h % 24} h` : `${d} day${d === 1 ? '' : 's'}`;
}

/** "Nov 4, 4:11 PM". */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Plain names for the processes that usually top the lists on the NUC. */
const PROCESS_NAMES: Record<string, string> = {
  vmmemWSL: "Docker's Linux VM",
  vmmem: "Docker's Linux VM",
  'com.docker.backend': 'Docker Desktop engine',
  'Docker Desktop': 'Docker Desktop app',
  MsMpEng: 'Microsoft Defender',
  svchost: 'Windows services',
  'Memory Compression': 'Windows memory compression',
  System: 'Windows',
  WmiPrvSE: 'Windows management (WMI)',
  dwm: 'Windows desktop',
  explorer: 'File Explorer',
  powershell: 'PowerShell',
  tailscaled: 'Tailscale',
  'tailscale-ipn': 'Tailscale',
  SearchIndexer: 'Windows Search',
  MSPCManager: 'Microsoft PC Manager',
  TiWorker: 'Windows Update',
  MoUsoCoreWorker: 'Windows Update',
};

export function processLabel(name: string): string {
  return PROCESS_NAMES[name] ?? name;
}

const EVENT_LABELS: Record<string, string> = {
  unexpected: 'Froze or lost power',
  restart: 'Restart requested',
  shutdown: 'Shut down',
  boot: 'Started',
  sleep: 'Went to sleep',
  wake: 'Woke up',
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}

type PowerEvent = NonNullable<import('../types').HostSnapshot['events']>[number];

/**
 * The power events worth a line each, newest first. A crash logs two (41 "rebooted without
 * shutting down", 6008 "the previous shutdown was unexpected"); keep the one that says when it went down.
 */
export function powerEvents(events: PowerEvent[] | null | undefined): PowerEvent[] {
  const list = events ?? [];
  const at = (e: PowerEvent) => new Date(e.at).getTime();
  return list.filter((e) => !(e.id === 41 && list.some((x) => x.id === 6008 && Math.abs(at(x) - at(e)) < 5 * 60_000)));
}

/** What to say under an event: why it restarted, or what Windows noticed; nothing for routine ones. */
export function eventDetail(e: PowerEvent): string | null {
  if (e.kind === 'restart' || e.kind === 'shutdown') return e.id === 1074 ? restartCause(e.message) : null;
  if (e.kind === 'unexpected') return e.id === 41 ? 'It restarted without shutting down cleanly.' : e.message;
  return null;
}

/** "By TrustedInstaller.exe · Operating System: Upgrade (Planned)", from event 1074's text. */
export function restartCause(message: string | null | undefined): string | null {
  if (!message) return null;
  const by = /The process (.+?) \(/.exec(message)?.[1];
  const why = /for the following reason: (.+?) Reason Code/.exec(message)?.[1];
  const parts = [by ? `By ${by.slice(by.lastIndexOf('\\') + 1)}` : null, why ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
