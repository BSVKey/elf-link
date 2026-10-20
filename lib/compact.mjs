// Compact messages for links measured in bits per minute (ELF). Every bit costs seconds, so a
// full payment never goes this way. What does: a short, authenticated signal that points at a
// payment or tells the receiver to come up to a faster link.
//
//   type 1 | seq 2 | body | tag 4
//
//   RECEIPT_OK / RECEIPT_FAIL   body = payment id (first 8 bytes of the txid)       15 bytes
//   BLOCK                       body = height 4 + first 4 bytes of the block hash  15 bytes
//   CALL_UP                     body = 1-byte code (come to TTE/VLF depth, raise buoy...) 8 bytes
//
// tag = HMAC-SHA256(shared key, the bytes before it), cut to 4 bytes: a forger's guess is right
// once in about 4 billion tries, and the receiver acts only on increasing seq (no replay). The key
// is shared in advance, because the receiver has no way to answer and nothing to spare for a
// public-key signature (about 70 bytes, which is 37 minutes at 0.25 bit/s).
import { createHmac, timingSafeEqual } from "node:crypto";

export const KIND = { RECEIPT_OK: 1, RECEIPT_FAIL: 2, BLOCK: 3, CALL_UP: 4 };
export const CALL = { TO_TTE_DEPTH: 1, RAISE_BUOY: 2, LISTEN_VLF: 3 };
const NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
const BODY = { 1: 8, 2: 8, 3: 8, 4: 1 };
const TAG = 4;

const tag = (key, bytes) => createHmac("sha256", key).update(bytes).digest().subarray(0, TAG);

export function encode(key, { kind, seq, body }) {
  const b = Buffer.from(body);
  if (b.length !== BODY[kind]) throw new Error(`${NAME[kind] ?? kind}: body must be ${BODY[kind]} bytes`);
  const head = Buffer.alloc(3); head[0] = kind; head.writeUInt16BE(seq & 0xffff, 1);
  const msg = Buffer.concat([head, b]);
  return Buffer.concat([msg, tag(key, msg)]);
}

// Returns the message, or null if it is malformed or the tag is wrong. Replay is the caller's job
// (see receiver()).
export function decode(key, bytes) {
  const b = Buffer.from(bytes);
  const n = BODY[b[0]];
  if (!n || b.length !== 3 + n + TAG) return null;
  const msg = b.subarray(0, 3 + n), t = b.subarray(3 + n);
  if (!timingSafeEqual(t, tag(key, msg))) return null;
  return { kind: NAME[b[0]], seq: b.readUInt16BE(1), body: b.subarray(3, 3 + n) };
}

export const receiptOk = (key, seq, txid) => encode(key, { kind: KIND.RECEIPT_OK, seq, body: Buffer.from(txid, "hex").subarray(0, 8) });
export const receiptFail = (key, seq, txid) => encode(key, { kind: KIND.RECEIPT_FAIL, seq, body: Buffer.from(txid, "hex").subarray(0, 8) });
export const callUp = (key, seq, code) => encode(key, { kind: KIND.CALL_UP, seq, body: Buffer.from([code]) });
export function block(key, seq, height, hashHex) {
  const body = Buffer.alloc(8); body.writeUInt32BE(height, 0);
  Buffer.from(hashHex, "hex").subarray(0, 4).copy(body, 4);
  return encode(key, { kind: KIND.BLOCK, seq, body });
}

// Acts on each authentic message once, in order; drops forgeries, repeats and replays.
export function receiver(key) {
  let last = -1;
  return (bytes) => {
    const m = decode(key, bytes);
    if (!m) return { accepted: false, why: "bad tag or malformed" };
    if (m.seq <= last) return { accepted: false, why: "repeat or replay", m };
    last = m.seq;
    return { accepted: true, m };
  };
}
