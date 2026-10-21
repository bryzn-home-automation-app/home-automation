// eufy-gate — cleans the start of each camera's live feed before go2rtc sees it.
//
// The eufy SoloCam S340 opens every live stream small (1280x720) and steps up to its
// full size (1920x1080) a few seconds in. A remuxed stream can't change size mid-way:
// browsers lock the picture to the first frame, so Safari shows black and Firefox a
// corrupt band. This proxy sits between go2rtc and the bridge's Annex-B /stream feed
// and drops the small warm-up frames, so the stream starts at full size. After that
// it's a plain pipe.
//
// It also points go2rtc's camera streams at itself: the bridge regenerates
// go2rtc.yaml with its own /stream URL on every start, so the sources are re-checked
// on a timer.

import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 3000);
const BRIDGE = process.env.BRIDGE_URL ?? "http://eufy-bridge:3000";
const GO2RTC = process.env.GO2RTC_URL ?? "http://eufy-bridge:1984";
const SELF = process.env.SELF_URL ?? "http://eufy-gate:3000";
/** Stop waiting for the full size after this long and send from the latest keyframe. */
const HOLD_MS = Number(process.env.HOLD_MS ?? 9000);
const HOLD_BYTES = 16 * 1024 * 1024;
/** How long into a stream to keep looking for a bigger picture. */
const LEARN_MS = 30_000;
const SYNC_EVERY_MS = 30_000;
/** Where learned full sizes are kept across restarts (unset: memory only). */
const STATE_FILE = process.env.STATE_FILE;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Annex-B parsing ──

const START = Buffer.from([0, 0, 0, 1]);

/** Splits a byte stream into NAL units (without start codes). Keeps the last, possibly partial, one. */
class NalSplitter {
  buf = Buffer.alloc(0);

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    let start = -1;
    let i = 0;
    while (i + 2 < this.buf.length) {
      if (this.buf[i] === 0 && this.buf[i + 1] === 0 && this.buf[i + 2] === 1) {
        if (start >= 0) out.push(trimZeros(this.buf.subarray(start, i)));
        start = i + 3;
        i += 3;
      } else {
        i++;
      }
    }
    if (start >= 0) {
      this.buf = this.buf.subarray(start - 3); // keep the open NAL with its start code
    }
    return out.filter((n) => n.length);
  }

  /** Whatever is buffered, as raw bytes (for switching to a plain pipe). */
  rest() {
    return this.buf;
  }
}

function trimZeros(b) {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return b.subarray(0, end);
}

/** HEVC (VPS byte 0x40) or H.264, decided from the first parameter set seen. */
function codecOf(nal) {
  const h = nal[0];
  if (((h >> 1) & 0x3f) === 32 || ((h >> 1) & 0x3f) === 33) return "hevc";
  if ((h & 0x1f) === 7) return "h264";
  return null;
}

const isSps = (codec, nal) => (codec === "hevc" ? ((nal[0] >> 1) & 0x3f) === 33 : (nal[0] & 0x1f) === 7);
const isVcl = (codec, nal) => {
  if (codec === "hevc") return ((nal[0] >> 1) & 0x3f) < 32;
  const t = nal[0] & 0x1f;
  return t >= 1 && t <= 5;
};

/** Picture size from an HEVC SPS, for the log ("1920x1080"); null if it can't be read. */
export function hevcSize(sps) {
  try {
    const rbsp = [];
    for (let i = 2; i < sps.length; i++) {
      if (i >= 4 && sps[i] === 3 && sps[i - 1] === 0 && sps[i - 2] === 0) continue; // emulation prevention
      rbsp.push(sps[i]);
    }
    let pos = 0;
    const bit = () => (rbsp[pos >> 3] >> (7 - (pos++ & 7))) & 1;
    const bits = (n) => {
      let v = 0;
      for (let k = 0; k < n; k++) v = v * 2 + bit();
      return v;
    };
    const ue = () => {
      let zeros = 0;
      while (bit() === 0) if (++zeros > 31) throw new Error("bad ue");
      return 2 ** zeros - 1 + bits(zeros);
    };
    bits(4); // sps_video_parameter_set_id
    const maxSub = bits(3);
    bits(1);
    bits(96); // general profile/tier/level
    const prof = [];
    const lvl = [];
    for (let k = 0; k < maxSub; k++) {
      prof.push(bit());
      lvl.push(bit());
    }
    if (maxSub > 0) for (let k = maxSub; k < 8; k++) bits(2);
    for (let k = 0; k < maxSub; k++) {
      if (prof[k]) bits(88);
      if (lvl[k]) bits(8);
    }
    ue(); // sps_seq_parameter_set_id
    if (ue() === 3) bits(1); // chroma_format_idc, separate_colour_plane_flag
    return `${ue()}x${ue()}`;
  } catch {
    return null;
  }
}

/** Picture size of a parameter set, or null when it can't be read (H.264 isn't parsed). */
const sizeOf = (codec, sps) => (codec === "hevc" ? hevcSize(sps) : null);
const area = (size) => (size ? size.split("x").reduce((a, b) => a * Number(b), 1) : 0);

/**
 * Holds a feed's opening frames until the camera reaches its full size, then writes
 * everything through. The S340 ramps up: it opens at 1280x720 and steps up to
 * 1920x1080 a few seconds in. The full size is learned per camera (the largest seen)
 * — until it's known, the feed passes untouched and is only watched. Calls `write`
 * with Annex-B bytes.
 */
export class Gate {
  constructor(sn, write, { now = () => Date.now(), steady = new Map(), onLearn = () => {} } = {}) {
    this.sn = sn;
    this.write = write;
    this.now = now;
    this.steady = steady;
    this.onLearn = onLearn;
    this.splitter = new NalSplitter();
    this.held = []; // NALs not yet sent
    this.heldBytes = 0;
    this.afterVcl = 0; // index in `held` just past the last picture: where a keyframe's parameter sets start
    this.keyStart = 0; // where the latest keyframe (its parameter sets) starts in `held`
    this.codec = null;
    this.since = this.now();
    this.dropped = 0;
    this.open = false; // decided — writing through from here on
    this.learnUntil = this.since + LEARN_MS;
  }

  push(chunk) {
    if (this.open) {
      this.write(chunk);
      if (!this.splitter) return;
      // Keep watching for a while, to learn the camera's full size.
      for (const nal of this.splitter.push(chunk)) this.learn(nal);
      if (this.now() > this.learnUntil) this.splitter = null;
      return;
    }
    for (const nal of this.splitter.push(chunk)) {
      if (this.open) {
        this.write(Buffer.concat([START, nal]));
        this.learn(nal);
      } else {
        this.take(nal);
      }
    }
    if (this.open) {
      // The open NAL went out raw-in-buffer; keep splitting a copy only to learn.
      const rest = this.splitter.rest();
      if (rest.length) this.write(rest);
      this.splitter = new NalSplitter();
      if (rest.length) this.splitter.push(rest);
    } else if (this.now() - this.since > HOLD_MS || this.heldBytes > HOLD_BYTES) {
      log(`${this.sn}: still below ${this.steady.get(this.sn)} after ${HOLD_MS} ms — sending the latest keyframe on`);
      this.release(this.keyStart);
    }
  }

  /** Remember the largest picture this camera sends. */
  learn(nal) {
    this.codec ??= codecOf(nal);
    if (!this.codec || !isSps(this.codec, nal)) return null;
    const size = sizeOf(this.codec, nal);
    if (size && area(size) > area(this.steady.get(this.sn))) {
      this.steady.set(this.sn, size);
      this.onLearn(this.sn, size);
      log(`${this.sn}: full size ${size}`);
    }
    return size;
  }

  take(nal) {
    this.codec ??= codecOf(nal);
    if (!this.codec) return; // nothing decodable before the first parameter set
    const target = this.steady.get(this.sn);
    if (isVcl(this.codec, nal)) {
      this.hold(nal);
      this.afterVcl = this.held.length;
      return;
    }
    if (isSps(this.codec, nal)) {
      const size = this.learn(nal);
      this.keyStart = this.afterVcl;
      if (!target || !size || size === target) {
        // Nothing known to wait for, or the camera is at full size: send from this keyframe.
        if (this.keyStart > 0) {
          this.dropped += this.held.slice(0, this.keyStart).filter((n) => isVcl(this.codec, n)).length;
          log(`${this.sn}: skipped ${this.dropped} smaller opening frame(s), starting at ${size} after ${this.now() - this.since} ms`);
        }
        this.hold(nal);
        this.release(this.keyStart);
        return;
      }
      // A smaller warm-up picture: nothing before this keyframe will ever be sent.
      this.dropped += this.held.slice(0, this.keyStart).filter((n) => isVcl(this.codec, n)).length;
      this.held = this.held.slice(this.keyStart);
      this.heldBytes = this.held.reduce((a, n) => a + n.length, 0);
      this.keyStart = this.afterVcl = 0;
    }
    this.hold(nal);
  }

  hold(nal) {
    this.held.push(nal);
    this.heldBytes += nal.length;
  }

  /** Send held NALs from `from` on and switch to writing through. */
  release(from) {
    const parts = [];
    for (const n of this.held.slice(from)) parts.push(START, n);
    this.held = [];
    this.open = true;
    if (parts.length) this.write(Buffer.concat(parts));
  }
}

// ── HTTP ──

/** Each camera's full picture size ("1920x1080"), learned from its streams. */
const steady = new Map();

function loadSteady() {
  if (!STATE_FILE) return;
  try {
    for (const [sn, size] of Object.entries(JSON.parse(readFileSync(STATE_FILE, "utf8")))) steady.set(sn, size);
    log(`full sizes: ${JSON.stringify(Object.fromEntries(steady))}`);
  } catch {
    /* first run */
  }
}

function saveSteady() {
  if (!STATE_FILE) return;
  try {
    writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(steady)));
  } catch (e) {
    log(`couldn't save ${STATE_FILE}: ${e.message}`);
  }
}

function serveStream(sn, req, res) {
  const up = http.get(`${BRIDGE}/stream/${sn}`, { headers: { "user-agent": req.headers["user-agent"] ?? "eufy-gate" } }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers);
    if (upRes.statusCode !== 200) return upRes.pipe(res);
    const gate = new Gate(sn, (b) => res.write(b), { steady, onLearn: saveSteady });
    upRes.on("data", (c) => gate.push(c));
    upRes.on("end", () => res.end());
    upRes.on("error", () => res.destroy());
  });
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `bridge: ${e.message}` }));
  });
  // The bridge ends the camera session when its viewer leaves — pass that on.
  res.on("close", () => up.destroy());
}

const server = http.createServer((req, res) => {
  const m = req.url?.match(/^\/stream\/([A-Za-z0-9]+)$/);
  if (req.method === "GET" && m) return serveStream(m[1], req, res);
  if (req.url === "/health") return res.end("ok");
  res.writeHead(404).end();
});

// ── go2rtc sources ──

const wanted = (sn) => `ffmpeg:${SELF}/stream/${sn}#video=copy#async`;

async function syncSources() {
  try {
    const streams = await (await fetch(`${GO2RTC}/api/streams`)).json();
    for (const [name, s] of Object.entries(streams ?? {})) {
      if (!/^[A-Za-z0-9]+$/.test(name)) continue;
      const urls = (s?.producers ?? []).map((p) => p.url ?? "");
      if (!urls.some((u) => u.includes(`/stream/${name}`)) || urls.includes(wanted(name))) continue;
      const q = new URLSearchParams({ name, src: wanted(name) });
      const r = await fetch(`${GO2RTC}/api/streams?${q}`, { method: "PUT" });
      log(`go2rtc ${name} → gate (${r.status})`);
    }
  } catch (e) {
    log(`go2rtc sync: ${e.message}`);
  }
}

if (process.argv[1]?.endsWith("gate.mjs") && !process.env.GATE_NO_SERVER) {
  loadSteady();
  server.listen(PORT, () => log(`eufy-gate on :${PORT} → ${BRIDGE}`));
  if (!process.env.GATE_NO_SYNC) {
    void syncSources();
    setInterval(syncSources, SYNC_EVERY_MS);
  }
}
