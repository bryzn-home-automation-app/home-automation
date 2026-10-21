// Minimal go2rtc MSE client (the protocol go2rtc's own video-rtc.js speaks):
// open the WebSocket, send {type:"mse", value:<codecs we can play>}, get back
// {type:"mse", value:<mime>} and then fMP4 fragments as binary frames.
// Plain WebSocket over TCP, so it passes through nginx and Docker's NAT —
// unlike WebRTC. iPhone Safari (17.1+) plays it via ManagedMediaSource.

const CODECS = [
  'avc1.640029', // H.264 high 4.1
  'avc1.64002A', // H.264 high 4.2
  'avc1.640033', // H.264 high 5.1
  'hvc1.1.6.L153.B0', // H.265 main 5.1
  'mp4a.40.2', // AAC LC
  'mp4a.40.5', // AAC HE
  'flac',
  'opus',
];

/** Seconds of video kept behind the playhead; older data is dropped. */
const KEEP_SECONDS = 10;
/**
 * Further than this behind the live edge while playing → jump forward. Generous on
 * purpose: seeking lands mid-GOP, and a Safari that's re-seeked on every fragment
 * never shows a frame.
 */
const CATCH_UP_SECONDS = 6;

type MediaSourceCtor = typeof MediaSource;

function mediaSourceCtor(): { ctor: MediaSourceCtor; managed: boolean } | null {
  const w = window as unknown as { ManagedMediaSource?: MediaSourceCtor; MediaSource?: MediaSourceCtor };
  if (w.ManagedMediaSource) return { ctor: w.ManagedMediaSource, managed: true };
  if (w.MediaSource) return { ctor: w.MediaSource, managed: false };
  return null;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.byteLength, 0));
  let off = 0;
  for (const b of chunks) {
    out.set(b, off);
    off += b.byteLength;
  }
  return out;
}

/** iPhone/iPad (incl. iPadOS reporting as a Mac). */
function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function canPlayNativeHls(): boolean {
  if (typeof document === 'undefined') return false;
  return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
}

/**
 * Use Safari's built-in HLS player instead of MSE: on iPhone/iPad (MSE there gave
 * black tiles with these H.265 streams), and anywhere MSE is missing but HLS isn't.
 */
export function preferHls(): boolean {
  return (isAppleMobile() && canPlayNativeHls()) || (mediaSourceCtor() === null && canPlayNativeHls());
}

/** Whether this browser can play live view at all. */
export function liveSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (typeof WebSocket !== 'undefined' && mediaSourceCtor() !== null) || canPlayNativeHls();
}

/** The codec list go2rtc picks from, filtered to what this browser can decode. */
export function supportedCodecs(isTypeSupported: (type: string) => boolean): string {
  return CODECS.filter((c) => isTypeSupported(`video/mp4; codecs="${c}"`)).join(',');
}

/** Same-origin ws(s):// URL for a path like /camera-stream/<ticket>/ws. */
export function socketUrl(path: string, location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${path}`;
}

/**
 * go2rtc's errors are terse ("codecs not matched: …"). The eufy cameras send
 * H.265, which Firefox and some PCs can't decode — say so plainly.
 */
export function friendlyError(raw: string | undefined): string {
  if (raw && /codec/i.test(raw)) return "This browser can't play this camera's H.265 video — try Safari, Chrome or Edge";
  return raw || 'The camera did not start';
}

/** What the player saw — sent to the backend log when live view doesn't start. */
export interface MseDiagnostics {
  managed: boolean;
  codecsOffered: string;
  mime: string | null;
  fragments: number;
  bytes: number;
  readyState: number;
  networkState: number;
  paused: boolean;
  currentTime: number;
  buffered: Array<[number, number]>;
  error: string | null;
  playError: string | null;
}

export interface MsePlayerHandlers {
  /** First frame is on screen. */
  onPlaying?: () => void;
  /** The stream can't start or broke (message is for the viewer). */
  onError?: (message: string) => void;
  /** The server closed the stream (e.g. the bridge's battery budget). */
  onEnded?: () => void;
}

/** What CameraTile drives: MSE over a WebSocket, or the browser's own HLS player. */
export interface LivePlayer {
  start(url: string): void;
  stop(): void;
  diagnostics(): MseDiagnostics | Record<string, unknown>;
}

/**
 * Safari's native HLS: point the video at the playlist URL and let the OS player do
 * buffering and decoding (hardware H.265). A few seconds more latency than MSE.
 */
export class HlsPlayer implements LivePlayer {
  private stopped = false;
  private playing = false;
  private playError: string | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly handlers: MsePlayerHandlers = {},
  ) {}

  start(url: string): void {
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.addEventListener('playing', this.onPlaying);
    v.addEventListener('error', this.onError);
    v.addEventListener('ended', this.onEnded);
    v.src = url;
    v.play().catch((err: unknown) => {
      this.playError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      v.addEventListener('canplay', () => void v.play().catch(() => {}), { once: true });
    });
  }

  stop(): void {
    this.stopped = true;
    const v = this.video;
    v.removeEventListener('playing', this.onPlaying);
    v.removeEventListener('error', this.onError);
    v.removeEventListener('ended', this.onEnded);
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  diagnostics() {
    const v = this.video;
    return {
      player: 'hls',
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      currentTime: Math.round(v.currentTime * 10) / 10,
      videoSize: `${v.videoWidth}x${v.videoHeight}`,
      error: v.error ? `code ${v.error.code}${v.error.message ? `: ${v.error.message}` : ''}` : null,
      playError: this.playError,
    };
  }

  private onPlaying = () => {
    if (this.playing || this.stopped) return;
    this.playing = true;
    this.handlers.onPlaying?.();
  };

  private onError = () => {
    if (this.stopped) return;
    const code = this.video.error?.code;
    this.handlers.onError?.(code === 4 ? "This camera's video format isn't supported here" : 'Live view stopped — try again');
  };

  private onEnded = () => {
    if (!this.stopped) this.handlers.onEnded?.();
  };
}

export class MsePlayer implements LivePlayer {
  private ws: WebSocket | null = null;
  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private pending: Uint8Array[] = [];
  private stopped = false;
  private playing = false;
  private started = false;
  private managed = false;
  private codecsOffered = '';
  private mime: string | null = null;
  private fragments = 0;
  private bytes = 0;
  private playError: string | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly handlers: MsePlayerHandlers = {},
  ) {}

  start(path: string): void {
    const source = mediaSourceCtor();
    if (!source) {
      this.handlers.onError?.("This browser can't play live video");
      return;
    }
    const ms = new source.ctor();
    this.ms = ms;
    this.managed = source.managed;
    // iOS only autoplays inline + muted; set both as properties, not just attributes.
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    ms.addEventListener(
      'sourceopen',
      () => {
        if (!source.managed) URL.revokeObjectURL(this.video.src);
        this.open(path, source.ctor);
      },
      { once: true },
    );
    this.video.addEventListener('playing', this.onVideoPlaying);
    if (source.managed) {
      // Required for ManagedMediaSource on iOS (no AirPlay of a MSE stream).
      (this.video as HTMLVideoElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
      this.video.srcObject = ms as unknown as MediaProvider;
    } else {
      this.video.src = URL.createObjectURL(ms);
    }
  }

  stop(): void {
    this.stopped = true;
    this.video.removeEventListener('playing', this.onVideoPlaying);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    this.sb = null;
    this.pending = [];
    try {
      if (this.ms?.readyState === 'open') this.ms.endOfStream();
    } catch {
      /* already closing */
    }
    this.ms = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.srcObject = null;
    this.video.load();
  }

  private onVideoPlaying = () => {
    if (this.playing || this.stopped) return;
    this.playing = true;
    this.handlers.onPlaying?.();
  };

  private open(path: string, ctor: MediaSourceCtor) {
    if (this.stopped) return;
    const ws = new WebSocket(socketUrl(path, window.location));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.codecsOffered = supportedCodecs((t) => ctor.isTypeSupported(t));
      ws.send(JSON.stringify({ type: 'mse', value: this.codecsOffered }));
    };
    ws.onmessage = (ev) => {
      if (this.stopped) return;
      if (typeof ev.data === 'string') {
        let msg: { type?: string; value?: string };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'mse' && msg.value) this.initBuffer(msg.value);
        else if (msg.type === 'error') this.fail(friendlyError(msg.value));
      } else {
        const chunk = new Uint8Array(ev.data as ArrayBuffer);
        this.fragments++;
        this.bytes += chunk.byteLength;
        this.append(chunk);
      }
    };
    ws.onerror = () => this.fail('Lost the connection to the camera');
    ws.onclose = () => {
      if (!this.stopped && this.ws === ws) {
        this.ws = null;
        this.handlers.onEnded?.();
      }
    };
  }

  private initBuffer(mime: string) {
    if (!this.ms || this.sb) return;
    try {
      this.mime = mime;
      const sb = this.ms.addSourceBuffer(mime);
      sb.mode = 'segments';
      sb.addEventListener('updateend', () => this.flush());
      this.sb = sb;
      // play() waits for the first buffered data (see flush): Safari needs the
      // playhead moved onto it first.
    } catch {
      this.fail("This browser can't decode this camera's video");
    }
  }

  private append(data: Uint8Array) {
    if (!this.sb) return;
    this.pending.push(data);
    if (!this.sb.updating) this.flush();
  }

  /**
   * Runs whenever the SourceBuffer is idle (on each fragment and after every
   * append/remove): trim old video first, then append everything queued. Each path
   * either starts an operation — whose updateend calls flush again — or leaves the
   * queue empty, so a failed append can't stall it (it used to: a QuotaExceeded
   * append queued the data with no updateend coming, and video froze for good).
   */
  private flush() {
    const sb = this.sb;
    if (!sb || sb.updating || this.stopped) return;
    const buffered = sb.buffered;
    const start = buffered.length ? buffered.start(0) : 0;
    if (buffered.length) {
      const end = buffered.end(buffered.length - 1);
      const v = this.video;
      if (!this.started) {
        // The first fragment rarely starts at 0. Chrome skips the gap by itself;
        // Safari waits at 0 forever — a black tile. Start where the data starts.
        this.started = true;
        if (v.currentTime < start) v.currentTime = start;
        this.play();
      } else if (!v.paused && !v.seeking && end - v.currentTime > CATCH_UP_SECONDS) {
        // Fell well behind while playing (a stall, a backgrounded tab): rejoin live.
        v.currentTime = end - 1;
      }
      // Drop old data, but never anything at or ahead of the playhead.
      const trimTo = Math.min(end - KEEP_SECONDS, v.currentTime - 2);
      if (trimTo - start > KEEP_SECONDS) {
        try {
          sb.remove(start, trimTo);
          return; // updateend → flush appends the queue
        } catch {
          /* fall through and try the append anyway */
        }
      }
    }
    if (!this.pending.length) return;
    const merged = concat(this.pending);
    this.pending = [];
    try {
      sb.appendBuffer(merged as BufferSource);
    } catch {
      // Buffer full (QuotaExceeded): drop this data and everything behind the
      // playhead; playback picks up again at the next keyframe.
      const behind = this.video.currentTime - 1;
      if (behind > start) {
        try {
          sb.remove(start, behind);
        } catch {
          /* nothing more to do */
        }
      }
    }
  }

  /** Muted inline play, retried once the browser can actually play. */
  private play() {
    const v = this.video;
    v.muted = true;
    v.play().catch((err: unknown) => {
      this.playError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      v.addEventListener('canplay', () => void v.play().catch(() => {}), { once: true });
    });
  }

  diagnostics(): MseDiagnostics {
    const v = this.video;
    const b = this.sb?.buffered;
    const ranges: Array<[number, number]> = [];
    if (b) for (let i = 0; i < b.length; i++) ranges.push([Math.round(b.start(i) * 10) / 10, Math.round(b.end(i) * 10) / 10]);
    return {
      managed: this.managed,
      codecsOffered: this.codecsOffered,
      mime: this.mime,
      fragments: this.fragments,
      bytes: this.bytes,
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      currentTime: Math.round(v.currentTime * 10) / 10,
      buffered: ranges,
      error: v.error ? `code ${v.error.code}${v.error.message ? `: ${v.error.message}` : ''}` : null,
      playError: this.playError,
    };
  }

  private fail(message: string) {
    if (this.stopped) return;
    this.handlers.onError?.(message);
  }
}
