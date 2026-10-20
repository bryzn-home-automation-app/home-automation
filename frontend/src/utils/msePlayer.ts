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

/** Seconds of video kept behind the live edge; older data is dropped. */
const KEEP_SECONDS = 10;
/** Further than this behind the live edge → jump forward. */
const MAX_LAG_SECONDS = 2;

type MediaSourceCtor = typeof MediaSource;

function mediaSourceCtor(): { ctor: MediaSourceCtor; managed: boolean } | null {
  const w = window as unknown as { ManagedMediaSource?: MediaSourceCtor; MediaSource?: MediaSourceCtor };
  if (w.ManagedMediaSource) return { ctor: w.ManagedMediaSource, managed: true };
  if (w.MediaSource) return { ctor: w.MediaSource, managed: false };
  return null;
}

/** Whether this browser can play live view at all. */
export function liveSupported(): boolean {
  return typeof window !== 'undefined' && typeof WebSocket !== 'undefined' && mediaSourceCtor() !== null;
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

export interface MsePlayerHandlers {
  /** First frame is on screen. */
  onPlaying?: () => void;
  /** The stream can't start or broke (message is for the viewer). */
  onError?: (message: string) => void;
  /** The server closed the stream (e.g. the bridge's battery budget). */
  onEnded?: () => void;
}

export class MsePlayer {
  private ws: WebSocket | null = null;
  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private pending: Uint8Array[] = [];
  private stopped = false;
  private playing = false;

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
    ws.onopen = () => ws.send(JSON.stringify({ type: 'mse', value: supportedCodecs((t) => ctor.isTypeSupported(t)) }));
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
        this.append(new Uint8Array(ev.data as ArrayBuffer));
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
      const sb = this.ms.addSourceBuffer(mime);
      sb.mode = 'segments';
      sb.addEventListener('updateend', () => this.flush());
      this.sb = sb;
      void this.video.play().catch(() => {
        /* muted autoplay can still be refused; the first frame shows anyway */
      });
    } catch {
      this.fail("This browser can't decode this camera's video");
    }
  }

  private append(data: Uint8Array) {
    const sb = this.sb;
    if (!sb) return;
    if (sb.updating || this.pending.length) {
      this.pending.push(data);
      return;
    }
    try {
      sb.appendBuffer(data as BufferSource);
    } catch {
      this.pending.push(data); // QuotaExceeded etc. — retry after the next trim
    }
  }

  private flush() {
    const sb = this.sb;
    if (!sb || sb.updating || this.stopped) return;
    if (this.pending.length) {
      const total = this.pending.reduce((n, b) => n + b.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of this.pending) {
        merged.set(b, off);
        off += b.byteLength;
      }
      this.pending = [];
      try {
        sb.appendBuffer(merged as BufferSource);
      } catch {
        /* dropped — the next keyframe recovers */
      }
      return;
    }
    const buffered = sb.buffered;
    if (!buffered.length) return;
    const start = buffered.start(0);
    const end = buffered.end(buffered.length - 1);
    if (end - start > KEEP_SECONDS * 2) {
      try {
        sb.remove(start, end - KEEP_SECONDS);
      } catch {
        /* ignore */
      }
    }
    if (end - this.video.currentTime > MAX_LAG_SECONDS) this.video.currentTime = end - 0.3;
  }

  private fail(message: string) {
    if (this.stopped) return;
    this.handlers.onError?.(message);
  }
}
