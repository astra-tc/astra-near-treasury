/**
 * Offline x402 paywall: challenge → mock pay → verify → snapshot.
 */

import { randomUUID } from "node:crypto";
import {
  type NetworkLabel,
  type PaymentChallenge,
  type PaymentReceipt,
  isPaymentReceipt,
} from "./schema.ts";
import { NonceStore } from "./nonce.ts";
import type { PaymentRpc } from "./rpc.ts";
import { buildSnapshot, type DataSnapshot } from "./snapshot.ts";

export interface PaywallConfig {
  amount: string;
  receiver: string;
  network: NetworkLabel;
  resource: string;
  rpc: PaymentRpc;
  nonces?: NonceStore;
  /** Optional clock / uuid hooks for tests. */
  now?: () => Date;
  newNonce?: () => string;
}

export type PaywallResult =
  | { status: 200; body: DataSnapshot }
  | { status: 402; body: PaymentChallenge; reason?: string }
  | { status: 409; body: { error: string; nonce: string } }
  | { status: 400; body: { error: string } };

export class Paywall {
  readonly nonces: NonceStore;
  private readonly amount: string;
  private readonly receiver: string;
  private readonly network: NetworkLabel;
  private readonly resource: string;
  private readonly rpc: PaymentRpc;
  private readonly now: () => Date;
  private readonly newNonce: () => string;

  constructor(cfg: PaywallConfig) {
    this.amount = cfg.amount;
    this.receiver = cfg.receiver;
    this.network = cfg.network;
    this.resource = cfg.resource;
    this.rpc = cfg.rpc;
    this.nonces = cfg.nonces ?? new NonceStore();
    this.now = cfg.now ?? (() => new Date());
    this.newNonce = cfg.newNonce ?? (() => randomUUID());
  }

  /** Issue a fresh 402 challenge (no receipt supplied). */
  challenge(): PaymentChallenge {
    const nonce = this.newNonce();
    this.nonces.issue(nonce, {
      amount: this.amount,
      receiver: this.receiver,
      resource: this.resource,
    });
    return {
      amount: this.amount,
      receiver: this.receiver,
      nonce,
      network: this.network,
      resource: this.resource,
    };
  }

  /**
   * Handle a request. Pass `receipt` when the client claims payment;
   * omit it (or pass null) to get a fresh 402 challenge.
   */
  async handle(receipt: PaymentReceipt | null | undefined): Promise<PaywallResult> {
    if (receipt == null) {
      return { status: 402, body: this.challenge() };
    }
    if (!isPaymentReceipt(receipt)) {
      return { status: 400, body: { error: "malformed payment receipt" } };
    }

    // Replay check first — even before RPC — so a used nonce is always 409.
    if (this.nonces.isUsed(receipt.nonce)) {
      return {
        status: 409,
        body: { error: "nonce already used (replay)", nonce: receipt.nonce },
      };
    }

    const issued = this.nonces.peek(receipt.nonce);
    if (!issued) {
      // Unknown nonce: re-challenge rather than 409.
      return {
        status: 402,
        body: this.challenge(),
        reason: "unknown_nonce",
      };
    }

    // Amount / receiver on the receipt must match the challenge.
    if (receipt.amount !== issued.amount || receipt.receiver !== issued.receiver) {
      return {
        status: 402,
        body: {
          amount: issued.amount,
          receiver: issued.receiver,
          nonce: receipt.nonce,
          network: this.network,
          resource: issued.resource,
        },
        reason: "wrong_amount_or_receiver",
      };
    }

    if (receipt.network !== this.network) {
      return {
        status: 402,
        body: {
          amount: issued.amount,
          receiver: issued.receiver,
          nonce: receipt.nonce,
          network: this.network,
          resource: issued.resource,
        },
        reason: "wrong_network",
      };
    }

    const payment = await this.rpc.getPayment(receipt.paymentId);
    if (!payment || !payment.settled) {
      return {
        status: 402,
        body: {
          amount: issued.amount,
          receiver: issued.receiver,
          nonce: receipt.nonce,
          network: this.network,
          resource: issued.resource,
        },
        reason: "unpaid",
      };
    }

    // On-chain (mock) amount / receiver must match challenge.
    if (payment.amount !== issued.amount || payment.receiver !== issued.receiver) {
      return {
        status: 402,
        body: {
          amount: issued.amount,
          receiver: issued.receiver,
          nonce: receipt.nonce,
          network: this.network,
          resource: issued.resource,
        },
        reason: "wrong_amount",
      };
    }

    const consumed = this.nonces.consume(receipt.nonce);
    if (!consumed.ok) {
      // Race: another request consumed it between peek and consume.
      return {
        status: 409,
        body: { error: "nonce already used (replay)", nonce: receipt.nonce },
      };
    }

    return {
      status: 200,
      body: buildSnapshot(issued.resource, this.network, this.now()),
    };
  }
}
