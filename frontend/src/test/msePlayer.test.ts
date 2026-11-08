import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOPLAY_RETRY_MS, HLS_STALL_MS, HlsPlayer, MsePlayer } from '../utils/msePlayer';

// Fakes just big enough to drive MsePlayer: a SourceBuffer that finishes each
// operation on the next tick (firing updateend) and can be told to throw.
class FakeSourceBuffer extends EventTarget {
  updating = false;
  mode = 'segments';
  appended: number[] = [];
  throwNext = false;
  private ranges: Array<[number, number]> = [];
  get buffered() {
    const r = this.ranges;
    return { length: r.length, start: (i: number) => r[i][0], end: (i: number) => r[i][1] } as TimeRanges;
  }
  appendBuffer(data: Uint8Array) {
    if (this.throwNext) {
      this.throwNext = false;
      throw new DOMException('full', 'QuotaExceededError');
    }
    this.appended.push(data.byteLength);
    this.ranges = [[0, this.appended.length]];
    this.finish();
  }
  remove() {
    this.finish();
  }
  private finish() {
    this.updating = true;
    setTimeout(() => {
      this.updating = false;
      this.dispatchEvent(new Event('updateend'));
    }, 0);
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported = () => true;
  readyState = 'open';
  sb = new FakeSourceBuffer();
  addSourceBuffer() {
    return this.sb;
  }
  endOfStream() {}
}

class FakeSocket {
  static last: FakeSocket;
  static OPEN = 1;
  readyState = 1;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(m: string) {
    this.sent.push(m);
  }
  close() {}
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('MsePlayer', () => {
  let ms: FakeMediaSource;

  beforeEach(() => {
    ms = new FakeMediaSource();
    const current = ms;
    vi.stubGlobal(
      'MediaSource',
      class {
        static isTypeSupported = () => true;
        constructor() {
          return current; // hand the player our fake
        }
      },
    );
    vi.stubGlobal('WebSocket', FakeSocket);
    URL.createObjectURL = vi.fn(() => 'blob:ms');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps playing after a QuotaExceeded append instead of freezing', async () => {
    const video = document.createElement('video');
    video.play = vi.fn().mockResolvedValue(undefined);
    const player = new MsePlayer(video);
    player.start('/camera-stream/t.s/ws');
    ms.dispatchEvent(new Event('sourceopen'));
    const ws = FakeSocket.last;
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0]).type).toBe('mse');
    ws.onmessage?.({ data: JSON.stringify({ type: 'mse', value: 'video/mp4; codecs="hvc1.1.6.L153.B0"' }) });

    const frame = (n: number) => ws.onmessage?.({ data: new Uint8Array(n).buffer });
    frame(10);
    await tick();
    ms.sb.throwNext = true; // the buffer is full for this one
    frame(20);
    await tick();
    frame(30);
    await tick();
    frame(40);
    await tick();

    // The rejected chunk is dropped, but later fragments still reach the buffer.
    expect(ms.sb.appended).toEqual([10, 30, 40]);
    player.stop();
  });
});

describe('player choice', () => {
  afterEach(() => vi.restoreAllMocks());

  it('iPhone gets Safari native HLS; a desktop with MediaSource keeps MSE', async () => {
    const { preferHls } = await import('../utils/msePlayer');
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    const ua = vi.spyOn(navigator, 'userAgent', 'get');

    ua.mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    expect(preferHls()).toBe(true);

    ua.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36');
    vi.stubGlobal('MediaSource', class {});
    expect(preferHls()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('HlsPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A video element that plays when told and whose clock the test moves. */
  function fakeVideo() {
    const v = Object.assign(new EventTarget(), {
      currentTime: 0,
      muted: false,
      playsInline: false,
      paused: false,
      readyState: 4,
      networkState: 2,
      videoWidth: 1920,
      videoHeight: 1080,
      error: null,
      src: '',
      setAttribute() {},
      removeAttribute() {},
      load() {},
      pause() {},
      play: () => Promise.resolve(),
    });
    return v as unknown as HTMLVideoElement & { currentTime: number };
  }

  it('ends a stream whose picture stops moving, so the tile reconnects', () => {
    const video = fakeVideo();
    const onEnded = vi.fn();
    const player = new HlsPlayer(video, { onEnded });
    player.start('/camera-stream/t/stream.m3u8');
    video.dispatchEvent(new Event('playing'));

    // Moving along: never ends.
    for (let i = 0; i < 10; i++) {
      video.currentTime += 1;
      vi.advanceTimersByTime(1_000);
    }
    expect(onEnded).not.toHaveBeenCalled();

    // Frozen (go2rtc dropped the session): ends once, after HLS_STALL_MS.
    vi.advanceTimersByTime(HLS_STALL_MS - 1_000);
    expect(onEnded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    player.stop();
  });

  /** A video whose play() the browser refuses until `allow` is set, the way iPhone Safari does. */
  function refusingVideo() {
    const v = fakeVideo() as HTMLVideoElement & { paused: boolean; allow: boolean };
    v.paused = true;
    v.allow = false;
    v.play = vi.fn(() => {
      if (!v.allow) return Promise.reject(new DOMException('The request is not allowed', 'NotAllowedError'));
      v.paused = false;
      return Promise.resolve();
    });
    return v;
  }

  it('keeps trying a start Safari refused, and asks for a tap meanwhile', async () => {
    const video = refusingVideo();
    const onBlocked = vi.fn();
    const player = new HlsPlayer(video, { onBlocked });
    player.start('/camera-stream/t/stream.m3u8');
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked).toHaveBeenLastCalledWith(true);
    expect(player.diagnostics()).toMatchObject({ blocked: true, playError: expect.stringContaining('NotAllowedError') });

    await vi.advanceTimersByTimeAsync(3 * AUTOPLAY_RETRY_MS);
    expect(video.play).toHaveBeenCalledTimes(4);
    expect(onBlocked).toHaveBeenCalledTimes(1);

    // The block lifts (the app has settled): the next retry gets it going, no tap needed.
    video.allow = true;
    await vi.advanceTimersByTimeAsync(AUTOPLAY_RETRY_MS);
    expect(onBlocked).toHaveBeenLastCalledWith(false);
    expect(player.diagnostics()).toMatchObject({ blocked: false, unblockedBy: 'retry' });
    await vi.advanceTimersByTimeAsync(5 * AUTOPLAY_RETRY_MS);
    expect(video.play).toHaveBeenCalledTimes(5);
    player.stop();
  });

  it('starts a refused video on the next tap anywhere on the page', async () => {
    const video = refusingVideo();
    const onBlocked = vi.fn();
    const player = new HlsPlayer(video, { onBlocked });
    player.start('/camera-stream/t/stream.m3u8');
    await vi.advanceTimersByTimeAsync(0);

    video.allow = true; // inside a tap, Safari lets it start
    document.body.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(onBlocked).toHaveBeenLastCalledWith(false);
    expect(player.diagnostics()).toMatchObject({ unblockedBy: 'tap' });
    player.stop();
  });

  it('stops listening for taps once stopped', async () => {
    const video = refusingVideo();
    const player = new HlsPlayer(video, {});
    player.start('/camera-stream/t/stream.m3u8');
    await vi.advanceTimersByTimeAsync(0);
    player.stop();
    const calls = vi.mocked(video.play).mock.calls.length;
    document.body.dispatchEvent(new Event('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(5 * AUTOPLAY_RETRY_MS);
    expect(video.play).toHaveBeenCalledTimes(calls);
  });

  it("doesn't count the wait before the first frame as a stall", () => {
    const video = fakeVideo();
    const onEnded = vi.fn();
    const player = new HlsPlayer(video, { onEnded });
    player.start('/camera-stream/t/stream.m3u8');
    vi.advanceTimersByTime(30_000);
    expect(onEnded).not.toHaveBeenCalled();
    player.stop();
  });
});
