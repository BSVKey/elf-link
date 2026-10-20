# elf-link (private)

Bitcoin BSV payment signals over the lowest radio bands: ELF to a submerged receiver, and
through-the-earth (TTE) radio to and from people underground. A physics-based rate model,
compact authenticated messages, and simulated links on a virtual clock.

**Everything here is simulation.** Nobody here can transmit ELF: it needs antennas miles long
and the US Navy closed its last ELF site in 2004. TTE radios are sold for mines and cave rescue,
but none has been used with this code. The rate anchors are assumptions for illustration, not
vendor or government figures.

```bash
npm install
node run-elf.mjs                  # ELF: what a few characters per minute can carry
node run-elf.mjs --depth=50
node run-tte.mjs                  # TTE: pay from 300 m underground, receipt back
node run-tte.mjs --depth=600      # too deep for a full payment: send its 8-byte id
node --test                       # 5 tests
```

## What fits where

| Link | Direction | Rate (model) | A 266-byte payment | What it is good for |
| --- | --- | --- | --- | --- |
| ELF, 76 Hz, antenna at 10 m in seawater | down only | 0.25 bit/s | 2 h 24 min: never sent this way | 15-byte "your payment settled" (10 min), "come up to a faster link" (8 bytes) |
| ELF, same, at 50 m | down only | 0.016 bit/s | 38 h | the same 15 bytes take 2 h 42 min |
| TTE, 3 kHz, 300 m of 100 ohm-m rock | both ways | 500 bit/s (assumed anchor) | 8 s up, receipt 4 s down | full payment and signed receipt |
| TTE, same, at 400 m | both ways | 10 bit/s | 8 min | still workable |
| TTE, same, at 500 m and below | both ways | 0.3 bit/s or less | hours | send the 8-byte payment id; the payment follows by hand |

Why the rates collapse with depth (`lib/physics.mjs`):
- **Skin depth.** Seawater and wet rock absorb the field: 8.7 dB per skin depth, where skin depth
  = 503 * sqrt(resistivity / frequency) m. Seawater at 76 Hz: 28.8 m. Rock of 100 ohm-m at 3 kHz:
  92 m. That is why these links use such low frequencies.
- **Near-field spreading (TTE).** Loop-to-loop magnetic coupling falls 60 dB per decade of
  distance.
- **Rate.** At low signal-to-noise, capacity is roughly linear in received power, so every 10 dB of
  extra loss divides the bit rate by 10.

## Messages

**ELF (`lib/compact.mjs`):** one way, so there are no acks: each message is repeated, and the
receiver keeps the first good copy.

| Message | Bytes | At 0.25 bit/s |
| --- | --- | --- |
| RECEIPT_OK / RECEIPT_FAIL: first 8 bytes of the txid | 15 | 10 min |
| BLOCK: height + first 4 bytes of the block hash | 15 | 10 min |
| CALL_UP: come to TTE/VLF depth, raise a buoy, listen on VLF | 8 | 4 min |

Each message carries a 2-byte sequence number and a 4-byte HMAC-SHA256 tag under a key shared
before deployment. A public-key signature (about 70 bytes) would take 37 minutes, and the
receiver cannot answer anyway. Forgeries, repeats and replays are refused. A BLOCK message takes
as long as a Bitcoin BSV block interval, so ELF cannot keep up with the chain. It can only mark
the occasional checkpoint.

**TTE:** the same frames, offline checks and signed receipts as the LoRa radio code in
BSVKey/dtn-custody-demo (`lib/radio/`, copied from there), with 64-byte frames and stop-and-wait
acks for a half-duplex link.

## Who might use it

- **Mines and tunnels:** paying for supplies, contractor sign-off and shift receipts from
  underground, with a receipt signed by the surface. TTE radios are already installed for
  safety.
- **Cave rescue and expeditions:** settle on the surface, confirm below.
- **Submerged platforms:** the ELF pattern (tiny authenticated signals down, the full payment
  up by buoy or satellite) applies to any very slow one-way downlink.

## Layout

```
lib/physics.mjs     skin depth, loss vs depth, bit rate, ELF and TTE profiles
lib/compact.mjs     ELF messages: 8 to 15 bytes, 4-byte HMAC tag, replay guard
lib/sim.mjs         virtual-clock link, one-way broadcast with repeats, two-way framed transfer
lib/radio/          frames, payments and receipts (copied from dtn-custody-demo radio/lib)
lib/demo.mjs        synthetic payment (nothing spendable, nothing sent)
run-elf.mjs         ELF scenario
run-tte.mjs         TTE scenario
```

Private repository. Uses only public physics and no export-controlled information.
