// HomeBase 3 (T8030) recordings over P2P — the pieces that don't need a live station.
//
// None of this is in eufy-sdk 0.4.0, which only downloads from a HomeBase 2. Measured on
// this HomeBase 3 (Oct 2026):
//
// - Listing: CMD_DATABASE inner cmd 10006 ("query by date") on `history_record_info`,
//   mChannel 255. It answers the recordings of only the FIRST day in [start_date,
//   end_date) that has any, newest first, up to `count` — so ask one day at a time.
//   A single-day range (start == end) answers nothing.
// - Download: CMD_DOWNLOAD_VIDEO with the row's `storage_path` (…/CameraNN/…/x.zxvideo)
//   on channel NN. The station streams CMD_VIDEO_FRAME (1300) / CMD_AUDIO_FRAME (1301)
//   frames, data type 3, unencrypted (cipher_id 0): video is Annex-B H.265 at the
//   recording's full size (2880x1616 on an S340), audio ADTS AAC. It never sends the
//   finish frame, so a transfer is done when `frame_num` video frames have arrived.

/** Inner CMD_DATABASE commands. */
export const DB_QUERY_BY_DATE = 10006;
export const CMD_VIDEO_FRAME = 1300;
export const CMD_AUDIO_FRAME = 1301;
export const CMD_DOWNLOAD_VIDEO = 1024;
export const CMD_DOWNLOAD_FINISH = 1304;
const RECORDING_DATA_TYPE = 3;
const VIDEO_HEADER = 22;
const AUDIO_HEADER = 16;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** The 10006 payload for one station-local calendar day ("2026-10-20"). */
export function dayQuery(day, count = 500) {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  return {
    count,
    start_date: ymd(start),
    end_date: ymd(end),
    start_id: 0,
    end_id: 1,
    flag: 0,
    need_ai: 1,
    res_unzip: 1,
    update_time: "0",
    start_time: "0",
    alarm_id: "",
  };
}

/** "2026-10-20 19:47:51" + "-0500" → "2026-10-20T19:47:51-05:00"; null when unreadable. */
export function stationTime(text, zone) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(text ?? "");
  if (!m || m[1] === "0000-00-00") return null;
  const z = /^([+-])(\d{2})(\d{2})$/.exec(zone ?? "");
  return `${m[1]}T${m[2]}${z ? `${z[1]}${z[2]}:${z[3]}` : "Z"}`;
}

/** The camera channel a recording lives on, from its path (/zx/emmcdata/Camera01/… → 1). */
export function channelOf(storagePath) {
  const m = /\/Camera(\d{2})\//.exec(storagePath ?? "");
  return m ? Number(m[1]) : null;
}

/** Rows of a 10006 reply as recordings; rows we can't play are dropped. */
export function parseRecordings(doc, stationSn) {
  if (!doc || !Array.isArray(doc.data)) return [];
  const out = [];
  for (const r of doc.data) {
    const start = stationTime(r?.start_time, r?.time_zone);
    const channel = channelOf(r?.storage_path);
    if (!r?.record_id || !r.device_sn || !start || channel == null || !/\.zxvideo$/.test(r.storage_path)) continue;
    const end = stationTime(r.end_time, r.time_zone);
    out.push({
      id: String(r.record_id),
      sn: r.device_sn,
      stationSn,
      start,
      end,
      durationMs: end ? Math.max(0, Date.parse(end) - Date.parse(start)) : null,
      frames: Number(r.frame_num) || 0,
      bytes: Number(r.folder_size) || 0,
      channel,
      path: r.storage_path,
      thumb: r.thumb_path || null,
    });
  }
  return out;
}

/** The first complete JSON object in `text` (replies arrive as fragments, sometimes with trailing padding). */
export function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Collects one recording's frames off a station session's `data` events. `push` answers
 * true once the transfer is complete (every expected video frame, or the finish frame).
 */
export class RecordingCollector {
  constructor({ channel, frames }) {
    this.channel = channel;
    this.expected = frames;
    this.video = [];
    this.audio = [];
    this.firstStamp = null;
    this.lastStamp = null;
    this.size = null;
    this.done = false;
    this.lastAt = 0;
  }

  push(frame) {
    if (this.done) return true;
    if (frame.commandId === CMD_DOWNLOAD_FINISH && (frame.channel === this.channel || frame.channel === 0)) {
      return (this.done = this.video.length > 0);
    }
    if (frame.channel !== this.channel || frame.dataType !== RECORDING_DATA_TYPE) return false;
    const raw = frame.raw ? Buffer.from(frame.raw) : null;
    if (!raw) return false;
    this.lastAt = Date.now();
    if (frame.commandId === CMD_VIDEO_FRAME && raw.length >= VIDEO_HEADER) {
      const len = raw.readUInt32LE(0);
      if (raw.length < VIDEO_HEADER + len) return false;
      this.video.push(raw.subarray(VIDEO_HEADER, VIDEO_HEADER + len));
      const stamp = raw.readUIntLE(14, 6);
      this.firstStamp ??= stamp;
      this.lastStamp = stamp;
      this.size ??= `${raw.readUInt16LE(10)}x${raw.readUInt16LE(12)}`;
    } else if (frame.commandId === CMD_AUDIO_FRAME && raw.length >= AUDIO_HEADER) {
      const len = raw.readUInt32LE(0);
      // ADTS sync word: anything else isn't a format we can mux.
      if (raw.length >= AUDIO_HEADER + len && raw[AUDIO_HEADER] === 0xff && (raw[AUDIO_HEADER + 1] & 0xf0) === 0xf0) {
        this.audio.push(raw.subarray(AUDIO_HEADER, AUDIO_HEADER + len));
      }
    }
    if (this.expected > 0 && this.video.length >= this.expected) this.done = true;
    return this.done;
  }

  /** Frames per second from the camera's own timestamps (15 when there's too little to tell). */
  fps() {
    const span = (this.lastStamp ?? 0) - (this.firstStamp ?? 0);
    if (this.video.length < 2 || span <= 0) return 15;
    return Math.round((((this.video.length - 1) * 1000) / span) * 100) / 100;
  }

  result() {
    return {
      video: Buffer.concat(this.video),
      audio: this.audio.length ? Buffer.concat(this.audio) : null,
      frames: this.video.length,
      fps: this.fps(),
      size: this.size,
    };
  }
}

/** ffmpeg arguments to mux the elementary streams into a phone-playable MP4 (no re-encode). */
export function muxArgs({ videoFile, audioFile, fps, out }) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts", "-framerate", String(fps), "-f", "hevc", "-i", videoFile];
  if (audioFile) args.push("-f", "aac", "-i", audioFile, "-map", "0:v", "-map", "1:a");
  // hvc1, not ffmpeg's default hev1: Safari only plays H.265 in MP4 tagged hvc1.
  args.push("-c", "copy", "-tag:v", "hvc1", "-movflags", "+faststart", "-f", "mp4", out);
  return args;
}
