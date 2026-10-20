// A payment from a synthetic funding output. Offline: nothing is fetched or sent, nothing is spendable.
import { PrivateKey, Transaction, P2PKH, SatoshisPerKilobyte } from "@bsv/sdk";

export async function demoPayment({ payer = PrivateKey.fromRandom(), to = PrivateKey.fromRandom().toAddress(), sats = 1000, fund = 10_000, feeRate = 100 } = {}) {
  const src = new Transaction();
  src.addInput({ sourceTXID: "11".repeat(32), sourceOutputIndex: 0, unlockingScript: new P2PKH().lock(payer.toAddress()), sequence: 0xffffffff });
  src.addOutput({ lockingScript: new P2PKH().lock(payer.toAddress()), satoshis: fund });
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(payer) });
  tx.addOutput({ lockingScript: new P2PKH().lock(to), satoshis: sats });
  tx.addOutput({ lockingScript: new P2PKH().lock(payer.toAddress()), change: true });
  await tx.fee(new SatoshisPerKilobyte(feeRate));
  await tx.sign();
  return { tx, to, sats };
}
