// node --test eufy-gate/ — the gate drops a camera's small warm-up frames and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gate, hevcSize } from "./gate.mjs";

const sc = (...nals) => Buffer.concat(nals.flatMap((n) => [Buffer.from([0, 0, 0, 1]), Buffer.from(n)]));
/** Hex with 3-byte start codes, so 3- and 4-byte framings compare equal. */
const norm = (b) => b.toString("hex").replaceAll("00000001", "000001");

// Real parameter sets: the S340's warm-up SPS (its start, closed with a stop bit) and the E30's full-size one.
const SPS_720 = Buffer.from("420101016000000300800000030000030078a00280802d1636fbbca66e0202020800000300080080", "hex");
const SPS_1080 = Buffer.from("QgEBIUAAAAMAkAAAAwAAAwCWoAPAgBDlnruRKFzUBAQEEAAAAwAQAAADAPCA", "base64");
const VPS = [0x40, 0x01, 0xaa];
const PPS = [0x44, 0x01, 0xc0];
const IDR = (b) => [0x26, 0x01, b];
const P = (b) => [0x02, 0x01, b];
const small = (b) => sc(VPS, SPS_720, PPS, IDR(b), P(b));
const full = (b) => sc(VPS, SPS_1080, PPS, IDR(b), P(b));

function run(chunks, { steady = new Map(), now } = {}) {
  const out = [];
  const g = new Gate("CAM", (b) => out.push(b), { steady, now });
  for (const c of chunks) g.push(c);
  return Buffer.concat(out);
}

test("reads the picture size from HEVC parameter sets", () => {
  assert.equal(hevcSize(SPS_1080), "1920x1080");
  assert.equal(hevcSize(SPS_720), "1280x720");
});

test("a camera with no known full size passes untouched, and its full size is learned", () => {
  const steady = new Map();
  const out = run([small(1), small(2), full(3), sc(P(4))], { steady });
  assert.ok(norm(out).startsWith(norm(Buffer.concat([small(1), small(2), full(3)]))));
  assert.equal(steady.get("CAM"), "1920x1080");
});

test("once known, small warm-up keyframes are dropped and the stream starts at full size", () => {
  const steady = new Map([["CAM", "1920x1080"]]);
  const out = run([small(1), small(2), small(3), full(4), sc(P(5))], { steady });
  assert.ok(norm(out).startsWith(norm(full(4))));
  assert.ok(!out.includes(SPS_720));
});

test("a camera already at full size starts at once", () => {
  const steady = new Map([["CAM", "1920x1080"]]);
  const out = run([sc(VPS, SPS_1080, PPS)], { steady });
  assert.ok(out.includes(SPS_1080));
});

test("NALs split across chunks survive", () => {
  const all = Buffer.concat([small(1), full(2), sc(P(9))]);
  const chunks = [];
  for (let i = 0; i < all.length; i += 3) chunks.push(all.subarray(i, i + 3));
  const out = run(chunks, { steady: new Map([["CAM", "1920x1080"]]) });
  assert.ok(norm(out).startsWith(norm(full(2))));
});

test("stuck small past the hold → sent from the latest keyframe", () => {
  let t = 0;
  const out = [];
  const g = new Gate("CAM", (b) => out.push(b), { steady: new Map([["CAM", "1920x1080"]]), now: () => t });
  g.push(small(1));
  g.push(small(2));
  assert.equal(out.length, 0);
  t = 60_000;
  g.push(sc(P(3)));
  const sent = norm(Buffer.concat(out));
  assert.ok(sent.startsWith(norm(sc(VPS, SPS_720, PPS, IDR(2)))), "starts at the latest keyframe");
  assert.ok(!sent.includes(norm(sc(IDR(1)))));
});
