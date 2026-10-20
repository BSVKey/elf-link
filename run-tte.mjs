#!/usr/bin/env node
// Through-the-earth: a worker underground pays the surface (canteen, supplies, a contractor) with
// a payment signed down there, and gets a receipt signed by the surface gateway back through the
// rock. Two way, so the full payment goes up in frames with acks.
//
//   node run-tte.mjs [--depth=300] [--ber=0.0005]
//
// Below the depth where a full payment takes too long, the worker sends only the payment's
// 8-byte id up; the signed payment itself waits for the next trip to the surface. Simulated
// link, virtual clock, synthetic payment; rates are a model anchored at an assumed 500 bit/s at
// 300 m (lib/physics.mjs).
import { PrivateKey } from "@bsv/sdk";
import { PROFILES, describe, human } from "./lib/physics.mjs";
import { lowBandLink, transfer, TYPE } from "./lib/sim.mjs";
import { demoPayment } from "./lib/demo.mjs";
import { encodePayment, decodePayment, checkOffline, signReceipt, readReceipt, STATUS } from "./lib/radio/payment.mjs";
import { messageId } from "./lib/radio/frame.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const depth = Number(arg("depth", "300")), ber = Number(arg("ber", "0.0005"));
const fmt = (bps) => (bps >= 10 ? bps.toFixed(0) : bps >= 0.01 ? bps.toFixed(2) : bps.toExponential(1));
const LIMIT_S = 600; // longest we let one payment take before falling back to the compact id
const p = PROFILES.tte;

const { tx } = await demoPayment();
const { type, msg } = encodePayment(tx);
const gw = PrivateKey.fromRandom(), gwPub = gw.toPublicKey().toString();

console.log(`${p.name}: ${p.freqHz} Hz through ${p.resistivityOhmM} ohm-m rock, skin depth ${describe(p, depth).skinDepthM.toFixed(0)} m, near-field loss 60 dB per decade`);
console.log(`\ndepth   loss vs ${p.ratedDepthM} m   bit rate     payment up + receipt down (no errors)`);
for (const d of [100, 200, 300, 400, 500, 700]) {
  const x = describe(p, d);
  const link = lowBandLink({ profile: p, depthM: d });
  const up = transfer(link, type, msg), down = transfer(link, TYPE.RECEIPT, Buffer.alloc(150), { dir: "down" });
  const total = up.seconds + down.seconds;
  console.log(`${String(d).padStart(4)} m   ${x.relLossDb.toFixed(1).padStart(8)} dB   ${fmt(x.bps).padStart(8)} bps   ${human(total).padStart(10)}${total > LIMIT_S ? "   too slow: send the 8-byte id instead" : ""}`);
}

const link = lowBandLink({ profile: p, depthM: depth, ber, seed: 3 });
console.log(`\nat ${depth} m, ${fmt(link.bps)} bit/s, bit error rate ${ber}:`);
const up = transfer(link, type, msg);
if (up.ok && up.seconds <= LIMIT_S) {
  console.log(`  worker   signed ${tx.id("hex").slice(0, 16)}... offline; sent ${msg.length} B up in ${up.frames} frames (${up.sends - up.frames} resent), ${human(up.seconds)}`);
  const got = decodePayment(up.type, up.msg), c = checkOffline(got);
  const receipt = signReceipt({ txid: c.txid, status: c.ok ? STATUS.VALID_NOT_SENT : STATUS.REJECTED, id: messageId(up.msg).toString("hex") }, gw);
  console.log(`  surface  rebuilt it, ${c.ok ? "checked offline OK" : `REJECTED: ${c.reason}`}; dry run, not broadcast; signed a ${receipt.length}-byte receipt`);
  const down = transfer(link, TYPE.RECEIPT, receipt, { dir: "down" });
  const r = down.ok && readReceipt(down.msg, gwPub);
  console.log(`  worker   receipt ${r ? `verified against the pinned surface key: ${r.status}` : "NOT verified"}, ${human(down.seconds)}`);
  console.log(`  total ${human(up.seconds + down.seconds)}`);
} else {
  const id = Buffer.from(tx.id("hex"), "hex").subarray(0, 8);
  const small = transfer(link, TYPE.PAY_EF, id);
  console.log(`  too deep for the full payment in ${human(LIMIT_S)}; sent its 8-byte id up instead: ${small.ok ? `arrived after ${human(small.seconds)}` : "lost"}`);
  console.log("  the signed payment itself goes up with the next person or cable run; the id lets the surface hold the goods for it");
}
