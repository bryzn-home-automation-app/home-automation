// eufy-recordings — lists and serves the recordings a HomeBase 3 keeps on its own storage.
//
// The bridge (ha-eufy-sdk-bridge) can't do this: its SDK only downloads from a HomeBase 2.
// This service runs its own eufy-sdk client next to it, hydrated from the bridge's saved
// session (read-only, never a fresh login — eufy allows one login per account and a new
// one would kick the bridge), and talks to the station over P2P. See hb3.mjs for the
// protocol. Internal only: the backend is the one caller, and checks who may watch.
//
//   GET /recordings?days=N        newest first, across every HomeBase 3
//   GET /recordings/:id           one recording's details
//   GET /recordings/:id/thumb.jpg the station's still for it
//   GET /recordings/:id/video.mp4 the recording, full size, as MP4 (cached on disk)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { EufyMega, LoginStatus, normalizePushImage } from "@mega-yfue/eufy-sdk";
import {
  CMD_DOWNLOAD_VIDEO,
  DB_QUERY_BY_DATE,
  RecordingCollector,
  dayQuery,
  firstJsonObject,
  muxArgs,
  parseRecordings,
} from "./hb3.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const SESSION_FILE = process.env.EUFY_SESSION_FILE ?? "/eufy/.eufy-session.json";
const CACHE = process.env.CACHE_DIR ?? "/cache";
const MAX_VIDEO_BYTES = Number(process.env.MAX_CACHE_MB ?? 3000) * 1024 * 1024;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 60;
const HOMEBASE_3 = "T8030";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(CACHE, "videos"), { recursive: true });
fs.mkdirSync(path.join(CACHE, "thumbs"), { recursive: true });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The station didn't answer at all — as opposed to answering with an error. */
class StationSilent extends HttpError {
  constructor(message) {
    super(504, message);
  }
}

// ── eufy client ──

/** The bridge's session file, read-only: hydrate from it, never write it. */
const store = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    } catch {
      return null;
    }
  },
  save() {},
  clear() {},
};

let clientPromise = null;

/**
 * A logged-in client. No password is given on purpose: if the saved session can't be
 * used, login fails here instead of logging in afresh and kicking the bridge out.
 */
function getClient() {
  clientPromise ??= (async () => {
    const c = new EufyMega({ email: process.env.EUFY_EMAIL, countryCode: process.env.EUFY_COUNTRY || "US", store, autoRealtime: false });
    c.on("error", (e) => log("sdk error:", e?.message ?? e));
    let r;
    try {
      r = await c.login();
    } catch (e) {
      throw new HttpError(503, `can't use the bridge's eufy session (${e?.message ?? e})`);
    }
    if (r.status !== LoginStatus.Ok) throw new HttpError(503, `eufy session not usable (${r.status})`);
    log("eufy session hydrated");
    return c;
  })();
  clientPromise.catch(() => (clientPromise = null)); // try again next time (the bridge may refresh it)
  return clientPromise;
}

async function dropClient() {
  const p = clientPromise;
  clientPromise = null;
  const c = await p?.catch(() => null);
  await Promise.resolve(c?.disconnect?.()).catch(() => {});
}

let inventoryCache = null;

/** HomeBase 3 stations with a camera on each (to open the session through) and the admin id. */
async function inventory() {
  if (inventoryCache && Date.now() - inventoryCache.at < 10 * 60_000) return inventoryCache;
  const c = await getClient();
  let devs;
  try {
    devs = await c.getDevices();
  } catch (e) {
    await dropClient();
    throw new HttpError(503, `eufy device list failed (${e?.message ?? e})`);
  }
  const accountId = devs.find((d) => d.raw?.member?.admin_user_id)?.raw?.member?.admin_user_id ?? "";
  const stations = devs
    .filter((d) => d.model === HOMEBASE_3)
    .map((d) => ({
      sn: d.sn,
      p2pDid: d.raw?.p2p_did,
      via: devs.find((x) => x.sn !== d.sn && x.raw?.station_sn === d.sn)?.sn ?? d.sn,
    }));
  inventoryCache = { at: Date.now(), accountId, stations };
  return inventoryCache;
}

async function stationSession(st) {
  const c = await getClient();
  await c.connectStation(st.via);
  const s = c.getP2pSessions().get(st.sn);
  if (!s) throw new HttpError(502, `no P2P session to ${st.sn}`);
  for (let i = 0; i < 40 && !s.isConnected; i++) await sleep(250);
  if (!s.isConnected) throw new StationSilent(`HomeBase ${st.sn} didn't connect`);
  return s;
}

const strikes = new Map(); // station sn → silences in a row

/**
 * A station can go quiet on a session that still reports connected: after ~3 hours on
 * Oct 21 2026 every list query timed out for three days, and only a restart fixed it.
 * Close the session so the next request opens a fresh one; a second silence in a row
 * re-hydrates the whole client instead, in case the bridge has refreshed the session.
 */
async function recover(st, why) {
  const n = (strikes.get(st.sn) ?? 0) + 1;
  strikes.set(st.sn, n);
  if (n > 1) {
    log(`${st.sn}: ${why} again — re-hydrating the eufy client`);
    strikes.delete(st.sn);
    return dropClient();
  }
  log(`${st.sn}: ${why} — reopening its P2P session`);
  const c = await clientPromise?.catch(() => null);
  await Promise.resolve(c?.getP2pSessions().get(st.sn)?.close()).catch(() => {});
}

/** Run `fn` against the station; when it goes silent, recover once and try again. */
async function withRecovery(st, fn) {
  try {
    const r = await fn();
    strikes.delete(st.sn);
    return r;
  } catch (e) {
    if (!(e instanceof StationSilent)) throw e;
    await recover(st, e.message);
    const r = await fn();
    strikes.delete(st.sn);
    return r;
  }
}

// One request at a time per station and kind: database replies aren't tied to their
// request, and the station sends one recording at a time. Images use their own lane —
// their replies carry the file name — so thumbnails don't wait behind a download.
const lanes = new Map();
function exclusive(key, fn) {
  const run = (lanes.get(key) ?? Promise.resolve()).then(fn, fn);
  lanes.set(key, run.catch(() => {}));
  return run;
}

// ── listing ──

const dayCache = new Map(); // `${stationSn}|${day}` → { at, recs }
const byId = new Map(); // recording id → recording

/** Station-local calendar days, today first ("2026-10-21", …). TZ is set to the station's. */
function lastDays(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** How long a day's list is trusted: today changes all the time, older days only when storage fills. */
function freshFor(dayIndex) {
  return dayIndex === 0 ? 30_000 : dayIndex === 1 ? 5 * 60_000 : 30 * 60_000;
}

function queryDay(st, accountId, day) {
  return exclusive(`${st.sn}|db`, () => withRecovery(st, () => askDay(st, accountId, day)));
}

async function askDay(st, accountId, day) {
  const s = await stationSession(st);
  let text = "";
  const onChunk = ({ text: t }) => (text += t);
  const sent = Date.now();
  s.on("dbChunk", onChunk);
  try {
    s.queryDatabase("history_record_info", { accountId, innerCmd: DB_QUERY_BY_DATE, channel: 255, query: dayQuery(day) });
    for (const until = Date.now() + 15_000; Date.now() < until; ) {
      await sleep(150);
      const doc = firstJsonObject(text);
      // A late reply to an earlier, abandoned query would carry an older transaction.
      if (doc && (doc.cmd !== DB_QUERY_BY_DATE || Number(doc.transaction) < sent)) {
        text = "";
        continue;
      }
      if (!doc) continue;
      if (doc.mIntRet) throw new HttpError(502, `HomeBase refused the list for ${day} (${doc.msg})`);
      return parseRecordings(doc, st.sn);
    }
    throw new StationSilent(`HomeBase didn't answer for ${day}`);
  } finally {
    s.off("dbChunk", onChunk);
  }
}

/**
 * Recordings over the last `days`. A station that fails one day isn't asked for the rest
 * this round (each miss costs a timeout, and the backend gives up long before seven) —
 * its days answer from cache where there is one. Only fails when nothing is left to show.
 */
async function listDays(days) {
  const { accountId, stations } = await inventory();
  const all = [];
  let failure = null;
  for (const st of stations) {
    const list = lastDays(days);
    let reachable = true;
    for (let i = 0; i < list.length; i++) {
      const key = `${st.sn}|${list[i]}`;
      let entry = dayCache.get(key);
      if (reachable && (!entry || Date.now() - entry.at > freshFor(i))) {
        try {
          entry = { at: Date.now(), recs: await queryDay(st, accountId, list[i]) };
          dayCache.set(key, entry);
        } catch (e) {
          reachable = false;
          failure = e;
          log(`list ${key}: ${e.message} — ${entry ? "keeping the earlier answer" : "skipped"}`);
        }
      }
      if (!entry) continue;
      for (const r of entry.recs) byId.set(r.id, r);
      all.push(...entry.recs);
    }
  }
  if (failure && !all.length) throw failure;
  return all.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/** A recording by id, looking up its day (the id starts YYYYMMDD) if it isn't known yet. */
async function recording(id) {
  if (!/^\d{13}$/.test(id)) throw new HttpError(404, "no such recording");
  if (byId.has(id)) return byId.get(id);
  const day = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
  const { accountId, stations } = await inventory();
  for (const st of stations) {
    const recs = await queryDay(st, accountId, day);
    for (const r of recs) byId.set(r.id, r);
  }
  const r = byId.get(id);
  if (!r) throw new HttpError(404, "no such recording");
  return r;
}

// ── media ──

function run(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000 }, (e, _out, err) => (e ? reject(new Error(`${cmd}: ${String(err || e.message).trim().slice(-300)}`)) : resolve())),
  );
}

const inflight = new Map();
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

/** Pull one recording off the station: its frames, collected until complete. */
async function download(rec) {
  const { accountId, stations } = await inventory();
  const st = stations.find((s) => s.sn === rec.stationSn);
  if (!st) throw new HttpError(404, "its HomeBase is gone");
  return exclusive(`${st.sn}|download`, () => withRecovery(st, () => pull(st, rec, accountId)));
}

async function pull(st, rec, accountId) {
  const s = await stationSession(st);
  const col = new RecordingCollector({ channel: rec.channel, frames: rec.frames });
  const started = Date.now();
  await new Promise((resolve, reject) => {
    let settled = false;
    const end = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      // Let trailing audio frames land rather than leak into the next transfer.
      setTimeout(() => {
        s.off("data", onData);
        err ? reject(err) : resolve();
      }, err ? 0 : 750);
    };
    const onData = (f) => col.push(f) && end();
    const tick = setInterval(() => {
      const now = Date.now();
      if (!col.lastAt && now - started > 20_000) end(new StationSilent("HomeBase sent nothing"));
      else if (col.lastAt && now - col.lastAt > 5_000) end(); // short a few frames: keep what came
      else if (now - started > 180_000) end(col.video.length ? undefined : new HttpError(504, "download timed out"));
    }, 250);
    s.on("data", onData);
    try {
      s.sendStringPairCommand(CMD_DOWNLOAD_VIDEO, rec.path, accountId, rec.channel);
    } catch (e) {
      end(new HttpError(502, e.message));
    }
  });
  const r = col.result();
  log(`recording ${rec.id}: ${r.frames}/${rec.frames} frames, ${r.size}, ${Math.round(r.video.length / 1024)} KB in ${Date.now() - started} ms`);
  return r;
}

async function videoFile(rec) {
  const file = path.join(CACHE, "videos", `${rec.id}.mp4`);
  if (fs.existsSync(file)) {
    const now = new Date();
    fs.utimesSync(file, now, now); // recently watched stays cached
    return file;
  }
  return once(`video ${rec.id}`, async () => {
    const r = await download(rec);
    if (!r.frames) throw new HttpError(502, "no video in the recording");
    const tmp = `${file}.${process.pid}`;
    const videoIn = `${tmp}.hevc`;
    const audioIn = r.audio ? `${tmp}.aac` : null;
    try {
      fs.writeFileSync(videoIn, r.video);
      if (audioIn) fs.writeFileSync(audioIn, r.audio);
      await run("ffmpeg", muxArgs({ videoFile: videoIn, audioFile: audioIn, fps: r.fps, out: tmp }));
      fs.renameSync(tmp, file);
    } finally {
      for (const f of [videoIn, audioIn, tmp]) if (f) fs.rmSync(f, { force: true });
    }
    pruneVideos();
    return file;
  });
}

/** Keep the video cache under its cap, least recently watched out first. */
function pruneVideos() {
  const dir = path.join(CACHE, "videos");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => ({ f, ...fs.statSync(path.join(dir, f)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let total = 0;
  for (const x of files) {
    total += x.size;
    if (total > MAX_VIDEO_BYTES) fs.rmSync(path.join(dir, x.f), { force: true });
  }
}

async function thumbFile(rec) {
  if (!rec.thumb) throw new HttpError(404, "no still for this recording");
  const file = path.join(CACHE, "thumbs", `${rec.id}.jpg`);
  if (fs.existsSync(file)) return file;
  const { accountId, stations } = await inventory();
  const st = stations.find((s) => s.sn === rec.stationSn);
  if (!st) throw new HttpError(404, "its HomeBase is gone");
  return once(`thumb ${rec.id}`, () =>
    exclusive(`${st.sn}|image`, async () => {
      const s = await stationSession(st);
      const data = await new Promise((resolve) => {
        const onImage = ({ file: f, data: d }) => {
          if (f !== rec.thumb) return;
          s.off("image", onImage);
          clearTimeout(timer);
          resolve(d);
        };
        const timer = setTimeout(() => {
          s.off("image", onImage);
          resolve(null);
        }, 10_000);
        s.on("image", onImage);
        s.requestImage(rec.thumb, { accountId });
      });
      const jpeg = data && data[0] === 0xff && data[1] === 0xd8 ? Buffer.from(data) : data ? normalizePushImage(data, st.p2pDid) : null;
      if (!jpeg || jpeg[0] !== 0xff) throw new HttpError(502, "HomeBase didn't send the still");
      // The station's still is full size; a list row needs a small one.
      const tmp = `${file}.${process.pid}`;
      fs.writeFileSync(`${tmp}.in.jpg`, jpeg);
      try {
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `${tmp}.in.jpg`, "-vf", "scale=480:-2", "-q:v", "5", "-f", "mjpeg", tmp]);
        fs.renameSync(tmp, file);
      } finally {
        fs.rmSync(`${tmp}.in.jpg`, { force: true });
        fs.rmSync(tmp, { force: true });
      }
      return file;
    }),
  );
}

// ── HTTP ──

const publicView = (r) => ({ id: r.id, sn: r.sn, start: r.start, end: r.end, durationMs: r.durationMs, bytes: r.bytes, hasThumb: !!r.thumb });

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

function sendFile(res, file, type) {
  const size = fs.statSync(file).size;
  res.writeHead(200, { "content-type": type, "content-length": size });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method !== "GET") throw new HttpError(405, "GET only");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/recordings") {
      const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
      return json(res, 200, { days, recordings: (await listDays(days)).map(publicView) });
    }
    const m = /^\/recordings\/(\d+)(?:\/(thumb\.jpg|video\.mp4))?$/.exec(url.pathname);
    if (!m) throw new HttpError(404, "not found");
    const rec = await recording(m[1]);
    if (!m[2]) return json(res, 200, publicView(rec));
    if (m[2] === "thumb.jpg") return sendFile(res, await thumbFile(rec), "image/jpeg");
    return sendFile(res, await videoFile(rec), "video/mp4");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) log(`${req.url}: ${e?.message ?? e}`);
    if (!res.headersSent) json(res, status, { error: e?.message ?? String(e) });
    else res.destroy();
  }
});

server.listen(PORT, () => log(`eufy-recordings on :${PORT}`));

// Keep the last week's list warm so the tab opens instantly.
async function warm() {
  try {
    await listDays(DEFAULT_DAYS);
  } catch (e) {
    log(`warm-up: ${e?.message ?? e}`);
  }
}
setTimeout(warm, 5_000);
setInterval(warm, 5 * 60_000);

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    server.close();
    await dropClient();
    process.exit(0);
  });
}
