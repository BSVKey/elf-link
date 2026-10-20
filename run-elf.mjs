#!/usr/bin/env node
// ELF, shore to a submerged receiver: what a few characters per minute can carry for payments.
//
//   node run-elf.mjs [--depth=10] [--ber=0.001] [--repeats=3]
//
// A payment made earlier (say over the TTE link, or before diving) is settled on shore. ELF tells
// the receiver it settled, without surfacing, in a 15-byte message with a 4-byte tag; a CALL_UP
// asks it to come to a faster link. ELF is one way, so there is no ack: messages are repeated.
// Simulated link, virtual clock, synthetic payment; rates are a model (lib/physics.mjs).
import { randomBytes } from "node:crypto";
import { PROFILES, describe, human } from "./lib/physics.mjs";
import { lowBandLink, broadcast } from "./lib/sim.mjs";
import { receiptOk, callUp, block, receiver, CALL } from "./lib/compact.mjs";
import { demoPayment } from "./lib/demo.mjs";
import { encodePayment } from "./lib/radio/payment.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const depth = Number(arg("depth", "10")), ber = Number(arg("ber", "0.001")), repeats = Number(arg("repeats", "3"));
const p = PROFILES.elf;

console.log(`${p.name}: ${p.freqHz} Hz, seawater skin depth ${describe(p, depth).skinDepthM.toFixed(1)} m (loss ${(8.686).toFixed(1)} dB per skin depth)`);
console.log(`\ndepth   loss vs ${p.ratedDepthM} m   bit rate      15-byte receipt   full payment (EF)`);
const { tx } = await demoPayment();
const ef = encodePayment(tx).msg.length;
for (const d of [10, 25, 50, 100, 150]) {
  const x = describe(p, d);
  console.log(`${String(d).padStart(4)} m   ${x.relLossDb.toFixed(1).padStart(8)} dB   ${x.bps.toExponential(2).padStart(9)} bps   ${human((15 * 8 + 32) / x.bps).padStart(14)}   ${human((ef * 8 + 32) / x.bps)}`);
}
console.log(`(a full ${ef}-byte payment never goes by ELF; it goes up by TTE, buoy or satellite)`);

const key = randomBytes(32); // shared before deployment
const link = lowBandLink({ profile: p, depthM: depth, ber, seed: 5 });
const rx = receiver(key);
const txid = tx.id("hex");
console.log(`\nat ${depth} m, ${link.bps} bit/s, bit error rate ${ber}, each message sent ${repeats} times:`);
let clock = 0;
for (const [label, msg] of [
  [`RECEIPT_OK for payment ${txid.slice(0, 16)}`, receiptOk(key, 1, txid)],
  ["BLOCK 971700", block(key, 2, 971700, "00".repeat(4) + "ab".repeat(28))],
  ["CALL_UP: come to TTE/VLF depth", callUp(key, 3, CALL.TO_TTE_DEPTH)],
]) {
  const r = broadcast(link, msg, { repeats });
  const got = r.deliveredAt === null ? null : rx(msg);
  console.log(`  ${label.padEnd(44)} ${msg.length} B  ${got?.accepted ? `received after ${human(clock + r.deliveredAt)}` : "LOST in all copies"}`);
  clock += r.seconds;
}
console.log(`  air time used: ${human(clock)}`);

const forged = Buffer.from(receiptOk(key, 9, txid)); forged[forged.length - 1] ^= 1;
console.log(`\nforged tag: ${rx(forged).why}; replay of the first message: ${rx(receiptOk(key, 1, txid)).why}`);
