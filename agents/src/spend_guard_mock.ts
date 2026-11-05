/**
 * Pure-TS mock of spend_guard decisions (mirrors contracts/spend_guard checks).
 * No NEAR RPC — offline unit tests only.
 */

export interface Policy {
  reserve: bigint;
  dailyCap: bigint;
}

export interface GuardState {
  policy: Policy;
  balance: bigint;
  spentToday: bigint;
  allowList: Set<string>;
  usedNonces: Set<number>;
}

export type SpendDecision =
  | { approved: true; reason: "proposed" }
  | {
      approved: false;
      reason:
        | "receiver_not_allowed"
        | "exceeds_daily_cap"
        | "breaks_reserve"
        | "nonce_replay"
        | "amount_zero";
    };

export function checkSpend(
  state: GuardState,
  receiver: string,
  amount: bigint,
  nonce: number,
): SpendDecision {
  if (amount <= 0n) return { approved: false, reason: "amount_zero" };
  if (state.usedNonces.has(nonce)) return { approved: false, reason: "nonce_replay" };
  if (!state.allowList.has(receiver)) {
    return { approved: false, reason: "receiver_not_allowed" };
  }
  if (state.spentToday + amount > state.policy.dailyCap) {
    return { approved: false, reason: "exceeds_daily_cap" };
  }
  if (amount > state.balance - state.policy.reserve) {
    return { approved: false, reason: "breaks_reserve" };
  }
  return { approved: true, reason: "proposed" };
}

/** Apply an approved spend into local mock state (for sequential proposals). */
export function applyApproved(
  state: GuardState,
  amount: bigint,
  nonce: number,
): GuardState {
  return {
    ...state,
    balance: state.balance - amount,
    spentToday: state.spentToday + amount,
    usedNonces: new Set([...state.usedNonces, nonce]),
    allowList: new Set(state.allowList),
    policy: { ...state.policy },
  };
}
