/**
 * Injectable payment RPC. Production would hit a chain; tests inject MockRpc.
 */

export interface PaymentRecord {
  paymentId: string;
  amount: string;
  receiver: string;
  /** Whether the payment settled successfully. */
  settled: boolean;
}

export interface PaymentRpc {
  /** Fetch a payment by id. Returns null if unknown / unpaid. */
  getPayment(paymentId: string): Promise<PaymentRecord | null>;
}

/** In-memory mock RPC for offline unit tests. */
export class MockRpc implements PaymentRpc {
  private readonly payments = new Map<string, PaymentRecord>();

  /** Register a settled (or intentionally unsettled) payment. */
  seed(record: PaymentRecord): void {
    this.payments.set(record.paymentId, { ...record });
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    const found = this.payments.get(paymentId);
    if (!found) return null;
    return { ...found };
  }

  clear(): void {
    this.payments.clear();
  }
}
