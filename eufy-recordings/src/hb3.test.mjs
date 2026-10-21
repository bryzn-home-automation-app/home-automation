// node --test eufy-recordings/src/hb3.test.mjs — HomeBase 3 reply parsing and frame collection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordingCollector, channelOf, dayQuery, firstJsonObject, muxArgs, parseRecordings, stationTime } from "./hb3.mjs";

// One real row (trimmed) from the station's 10006 reply.
const ROW = {
  device_sn: "T8170T1025305BAA",
  end_time: "2026-10-20 19:48:11",
  folder_size: 4693164,
  frame_num: 299,
  record_id: 2026102000042,
  start_time: "2026-10-20 19:47:51",
  storage_path: "/zx/emmcdata/Camera00/202610/20261020194751/20261020194751.zxvideo",
  thumb_path: "/zx/emmcdata/Camera00/202610/20261020194751/snapshort.jpg",
  time_zone: "-0500",
};

test("asks for one day as [day, next day)", () => {
  const q = dayQuery("2026-10-31");
  assert.equal(q.start_date, "20261031");
  assert.equal(q.end_date, "20261101");
  assert.equal(q.count, 500);
});

test("station times carry their zone", () => {
  assert.equal(stationTime("2026-10-20 19:47:51", "-0500"), "2026-10-20T19:47:51-05:00");
  assert.equal(stationTime("0000-00-00 00:00:00", "-0500"), null);
  assert.equal(Date.parse(stationTime("2026-10-20 19:47:51", "-0500")), Date.parse("2026-10-21T00:47:51Z"));
});

test("rows become recordings; unplayable rows are dropped", () => {
  const recs = parseRecordings({ data: [ROW, { ...ROW, record_id: 2, storage_path: "/x/y.jpg" }, { record_id: 3 }] }, "T8030X");
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0], {
    id: "2026102000042",
    sn: "T8170T1025305BAA",
    stationSn: "T8030X",
    start: "2026-10-20T19:47:51-05:00",
    end: "2026-10-20T19:48:11-05:00",
    durationMs: 20_000,
    frames: 299,
    bytes: 4693164,
    channel: 0,
    path: ROW.storage_path,
    thumb: ROW.thumb_path,
  });
  assert.equal(channelOf("/zx/emmcdata/Camera01/a/b.zxvideo"), 1);
  assert.deepEqual(parseRecordings({ data: "" }), []);
});

test("first JSON object, ignoring the padding after it", () => {
  assert.deepEqual(firstJsonObject('{"cmd":10006,"data":[{"a":"}"}]}ÌÌ'), { cmd: 10006, data: [{ a: "}" }] });
  assert.equal(firstJsonObject('{"cmd":10006,"da'), undefined);
});

function videoFrame(seq, stamp, payload, { channel = 0, key = 0 } = {}) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(payload.length, 0);
  h[4] = key;
  h[5] = 2;
  h.writeUInt16LE(seq, 6);
  h[8] = 15;
  h.writeUInt16LE(2880, 10);
  h.writeUInt16LE(1616, 12);
  h.writeUIntLE(stamp, 14, 6);
  return { commandId: 1300, channel, dataType: 3, raw: Buffer.concat([h, payload]) };
}

function audioFrame(payload) {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(payload.length, 0);
  return { commandId: 1301, channel: 0, dataType: 3, raw: Buffer.concat([h, payload]) };
}

test("collects a recording until every expected video frame is in", () => {
  const c = new RecordingCollector({ channel: 0, frames: 3 });
  const nal = (b) => Buffer.from([0, 0, 0, 1, 0x26, 1, b]);
  assert.equal(c.push(videoFrame(1, 1_000, nal(1), { key: 1 })), false);
  assert.equal(c.push({ commandId: 1300, channel: 1, dataType: 3, raw: Buffer.alloc(40) }), false, "other channel ignored");
  assert.equal(c.push(audioFrame(Buffer.from([0xff, 0xf1, 0x60, 0x40]))), false);
  assert.equal(c.push(audioFrame(Buffer.from([0x12, 0x34]))), false, "non-ADTS audio skipped");
  assert.equal(c.push(videoFrame(2, 1_500, nal(2))), false);
  assert.equal(c.push(videoFrame(3, 2_000, nal(3))), true);
  const r = c.result();
  assert.equal(r.frames, 3);
  assert.equal(r.size, "2880x1616");
  assert.equal(r.fps, 2);
  assert.deepEqual(r.video, Buffer.concat([nal(1), nal(2), nal(3)]));
  assert.deepEqual(r.audio, Buffer.from([0xff, 0xf1, 0x60, 0x40]));
});

test("a finish frame ends the transfer early", () => {
  const c = new RecordingCollector({ channel: 1, frames: 100 });
  c.push(videoFrame(1, 0, Buffer.from([0, 0, 0, 1, 0x26]), { channel: 1 }));
  assert.equal(c.push({ commandId: 1304, channel: 1 }), true);
});

test("mux keeps the streams and tags H.265 for Safari", () => {
  const a = muxArgs({ videoFile: "v", audioFile: "a", fps: 14.8, out: "o.mp4" });
  assert.ok(a.includes("hvc1"));
  assert.deepEqual(a.slice(a.indexOf("-c"), a.indexOf("-c") + 2), ["-c", "copy"]);
  assert.ok(!muxArgs({ videoFile: "v", audioFile: null, fps: 15, out: "o" }).includes("aac"));
});
