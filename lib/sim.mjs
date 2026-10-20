// A simulated low-band link on a virtual clock: ELF messages take minutes to hours, so nothing
// here waits in real time. A link has a bit rate (from the physics at a depth), a bit error
// rate, and a direction rule (ELF is down only).
import { bitRate } from "./physics.mjs";
import { split, parse, reassembler, TYPE } from "./radio/frame.mjs";

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function lowBandLink({ profile, depthM, ber = 0, seed = 1, syncBits = 32 }) {
  const bps = bitRate(profile, depthM), rand = prng(seed);
  const stats = { sent: 0, lost: 0, bits: 0, seconds: 0 };
  return {
    bps, oneWay: profile.oneWay, stats,
    // Send bytes; dir "down" (surface to receiver) or "up". Returns { seconds, lost }.
    transmit(bytes, dir = "down") {
      if (dir === "up" && profile.oneWay) throw new Error(`${profile.name} is one way: nothing can be sent up`);
      const bits = bytes.length * 8 + syncBits;
      const seconds = bits / bps;
      const lost = rand() < 1 - (1 - ber) ** bits;
      stats.sent++; stats.bits += bits; stats.seconds += seconds; if (lost) stats.lost++;
      return { seconds, lost };
    },
  };
}

// One-way broadcast: send the same message `repeats` times; the receiver keeps the first good
// copy. Returns { seconds, deliveredAt (seconds, or null), copies }.
export function broadcast(link, bytes, { repeats = 3 } = {}) {
  let t = 0, deliveredAt = null;
  for (let i = 0; i < repeats; i++) {
    const r = link.transmit(bytes, "down");
    t += r.seconds;
    if (!r.lost && deliveredAt === null) deliveredAt = t;
  }
  return { seconds: t, deliveredAt, copies: repeats };
}

// Two-way transfer of one message in frames, stop and wait: each frame is acknowledged by a
// short frame the other way (half duplex, so the ack costs air time too). Returns the message as
// the far side rebuilt it, the virtual seconds it took, and the frame counts.
export function transfer(link, type, msg, { dir = "up", mtu = 64, ackBytes = 4, maxTries = 20 } = {}) {
  const back = dir === "up" ? "down" : "up";
  const frames = split(type, msg, { mtu });
  const parts = reassembler();
  let t = 0, sends = 0, whole = null;
  for (const f of frames) {
    for (let tries = 0; ; tries++) {
      if (tries >= maxTries) return { ok: false, seconds: t, sends, frames: frames.length };
      const r = link.transmit(f, dir); t += r.seconds; sends++;
      if (r.lost) continue; // no ack comes; the sender times out and repeats
      whole = parts.add(parse(f)) ?? whole;
      const a = link.transmit(Buffer.alloc(ackBytes), back); t += a.seconds;
      if (!a.lost) break; // a lost ack means the frame is sent again; the receiver ignores the copy
    }
  }
  return { ok: !!whole?.msg, msg: whole?.msg, type: whole?.type, seconds: t, sends, frames: frames.length };
}

export { TYPE };
