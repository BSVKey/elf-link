// How deep a low-frequency signal reaches, and how fast data can go once it is there.
//
// Two effects set the loss:
//   skin depth   a conductor (seawater, wet rock) eats the field. Loss is 8.686 dB per skin
//                depth, and skin depth = 503 * sqrt(resistivity / frequency) metres. Lower
//                frequency goes deeper, which is the whole reason ELF and ULF exist.
//   spreading    through-the-earth (TTE) radios use a magnetic loop in its near field, where the
//                field falls as 1/r^3, so power falls 60 dB per decade of distance.
//
// Rate: at low signal-to-noise, capacity is close to linear in received power (Shannon,
// C ~ B * SNR / ln 2), so every 10 dB of extra loss divides the usable bit rate by 10. Each
// profile is anchored to a rated bit rate at a rated depth and scaled from there. The anchors
// are assumptions for illustration, not vendor or government figures: change them per system.

export const skinDepthM = (resistivityOhmM, freqHz) => 503 * Math.sqrt(resistivityOhmM / freqHz);
export const skinLossDb = (depthM, resistivityOhmM, freqHz) => 8.686 * depthM / skinDepthM(resistivityOhmM, freqHz);
export const nearFieldLossDb = (distM, refM) => 60 * Math.log10(distM / refM);

export const PROFILES = {
  // Shore-to-submarine ELF: one way, down only (a submarine cannot radiate ELF). Public
  // descriptions put the rate at a few characters per minute; 0.25 bit/s is that order.
  // The rate is anchored at the receiving antenna's depth below the sea surface.
  elf: {
    name: "ELF, shore to submarine",
    freqHz: 76, resistivityOhmM: 0.25, // seawater, about 4 S/m
    ratedBps: 0.25, ratedDepthM: 10, maxBps: 0.25,
    oneWay: true, spreading: false,
  },
  // Through-the-earth mine radio: two way, magnetic loop to magnetic loop through rock.
  tte: {
    name: "Through-the-earth (ULF/VLF), surface to underground",
    freqHz: 3000, resistivityOhmM: 100, // typical wet sedimentary rock
    ratedBps: 500, ratedDepthM: 300, maxBps: 2000,
    oneWay: false, spreading: true,
  },
};

// Loss in dB at depthM, relative to the profile's rated depth (negative = better than rated).
export function relativeLossDb(p, depthM) {
  let db = skinLossDb(depthM, p.resistivityOhmM, p.freqHz) - skinLossDb(p.ratedDepthM, p.resistivityOhmM, p.freqHz);
  if (p.spreading) db += nearFieldLossDb(depthM, p.ratedDepthM);
  return db;
}

export function bitRate(p, depthM) {
  return Math.min(p.maxBps, p.ratedBps * 10 ** (-relativeLossDb(p, depthM) / 10));
}

export function describe(p, depthM) {
  return { depthM, skinDepthM: skinDepthM(p.resistivityOhmM, p.freqHz), relLossDb: relativeLossDb(p, depthM), bps: bitRate(p, depthM) };
}

// "1 h 12 min", "38 s", "2.4 days"
export function human(seconds) {
  if (!isFinite(seconds)) return "never";
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) { const h = Math.floor(seconds / 3600); return `${h} h ${Math.round((seconds - h * 3600) / 60)} min`; }
  return `${(seconds / 86400).toFixed(1)} days`;
}
