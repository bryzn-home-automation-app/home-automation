import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MsePlayer } from '../utils/msePlayer';

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
