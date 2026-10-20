// Offline: physics numbers, compact ELF messages, and payments over the simulated links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrivateKey } from "@bsv/sdk";
import { skinDepthM, PROFILES, bitRate, relativeLossDb } from "../lib/physics.mjs";
import { encode, decode, receiptOk, callUp, block, receiver, KIND, CALL } from "../lib/compact.mjs";
import { lowBandLink, broadcast, transfer, TYPE } from "../lib/sim.mjs";
import { demoPayment } from "../lib/demo.mjs";
import { encodePayment, decodePayment, checkOffline, signReceipt, readReceipt, STATUS } from "../lib/radio/payment.mjs";

test("physics: skin depth matches the textbook values", () => {
  assert.equal(skinDepthM(0.25, 76).toFixed(1), "28.8"); // seawater at 76 Hz
  assert.equal(skinDepthM(100, 3000).toFixed(1), "91.8"); // 100 ohm-m rock at 3 kHz
  assert.equal(relativeLossDb(PROFILES.elf, PROFILES.elf.ratedDepthM), 0);
  assert.equal(bitRate(PROFILES.tte, 300), 500);
  assert.ok(bitRate(PROFILES.tte, 100) <= PROFILES.tte.maxBps);
  // deeper is always slower once past the rated depth
  for (const p of Object.values(PROFILES)) assert.ok(bitRate(p, p.ratedDepthM * 2) < bitRate(p, p.ratedDepthM));
});

test("compact: authentic messages decode; a flipped bit, a wrong key, a replay are refused", () => {
  const key = randomBytes(32), txid = "cd".repeat(32);
  const m = receiptOk(key, 7, txid);
  assert.equal(m.length, 15);
  assert.deepEqual({ ...decode(key, m), body: decode(key, m).body.toString("hex") }, { kind: "RECEIPT_OK", seq: 7, body: "cd".repeat(8) });
  assert.equal(callUp(key, 1, CALL.TO_TTE_DEPTH).length, 8);
  assert.equal(decode(key, block(key, 2, 971700, "ab".repeat(32))).body.readUInt32BE(0), 971700);

  const bad = Buffer.from(m); bad[5] ^= 1;
  assert.equal(decode(key, bad), null);
  assert.equal(decode(randomBytes(32), m), null);
  assert.throws(() => encode(key, { kind: KIND.RECEIPT_OK, seq: 1, body: Buffer.alloc(3) }));

  const rx = receiver(key);
  assert.equal(rx(m).accepted, true);
  assert.equal(rx(m).accepted, false);
  assert.equal(rx(receiptOk(key, 8, txid)).accepted, true);
});

test("ELF: one way only; a 15-byte receipt at the rated depth takes about 10 minutes", () => {
  const link = lowBandLink({ profile: PROFILES.elf, depthM: 10 });
  assert.throws(() => link.transmit(Buffer.alloc(1), "up"), /one way/);
  const r = broadcast(link, receiptOk(randomBytes(32), 1, "00".repeat(32)), { repeats: 1 });
  assert.equal(Math.round(r.deliveredAt), (15 * 8 + 32) / 0.25);
});

test("ELF: repeats get a message through bit errors that lose single copies", () => {
  const key = randomBytes(32), msg = receiptOk(key, 1, "00".repeat(32));
  let once = 0, thrice = 0;
  for (let seed = 1; seed <= 200; seed++) {
    if (broadcast(lowBandLink({ profile: PROFILES.elf, depthM: 10, ber: 0.004, seed }), msg, { repeats: 1 }).deliveredAt !== null) once++;
    if (broadcast(lowBandLink({ profile: PROFILES.elf, depthM: 10, ber: 0.004, seed }), msg, { repeats: 3 }).deliveredAt !== null) thrice++;
  }
  assert.ok(thrice > once, `${thrice} vs ${once}`);
});

test("TTE: a full payment goes up through bit errors, checks offline, and the signed receipt comes down", async () => {
  const { tx } = await demoPayment();
  const { type, msg } = encodePayment(tx);
  const link = lowBandLink({ profile: PROFILES.tte, depthM: 300, ber: 0.001, seed: 9 });
  const up = transfer(link, type, msg);
  assert.equal(up.ok, true);
  assert.ok(up.sends > up.frames, "some frames should have been resent at this error rate");
  const got = decodePayment(up.type, up.msg);
  assert.equal(got.id("hex"), tx.id("hex"));
  assert.equal(checkOffline(got).ok, true);

  const gw = PrivateKey.fromRandom();
  const receipt = signReceipt({ txid: got.id("hex"), status: STATUS.VALID_NOT_SENT, id: "00".repeat(8) }, gw);
  const down = transfer(link, TYPE.RECEIPT, receipt, { dir: "down" });
  assert.equal(readReceipt(down.msg, gw.toPublicKey().toString()).txid, tx.id("hex"));
  assert.ok(up.seconds + down.seconds < 60);
});
