/**
 * Tiny paid data snapshot served after a verified receipt.
 */

export interface DataSnapshot {
  resource: string;
  asOf: string;
  /** Demo treasury headline numbers — fictional sandbox data. */
  treasury: {
    balanceYocto: string;
    reserveYocto: string;
    spentTodayYocto: string;
    network: "sandbox" | "testnet";
  };
  note: string;
}

export function buildSnapshot(
  resource: string,
  network: "sandbox" | "testnet",
  now: Date = new Date(),
): DataSnapshot {
  return {
    resource,
    asOf: now.toISOString(),
    treasury: {
      balanceYocto: "1000000000000000000000000",
      reserveYocto: "100000000000000000000000",
      spentTodayYocto: "0",
      network,
    },
    note: "sandbox snapshot — not live chain state",
  };
}
