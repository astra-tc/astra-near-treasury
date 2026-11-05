/**
 * In-memory nonce store. Replay of a consumed nonce → conflict (HTTP 409).
 */

export class NonceStore {
  private readonly used = new Set<string>();
  private readonly issued = new Map<string, { amount: string; receiver: string; resource: string }>();

  /** Issue a fresh nonce bound to a challenge. */
  issue(nonce: string, meta: { amount: string; receiver: string; resource: string }): void {
    if (this.used.has(nonce) || this.issued.has(nonce)) {
      throw new Error(`nonce already issued or used: ${nonce}`);
    }
    this.issued.set(nonce, { ...meta });
  }

  /** Look up an issued (not yet consumed) challenge. */
  peek(nonce: string): { amount: string; receiver: string; resource: string } | undefined {
    return this.issued.get(nonce);
  }

  /** True if this nonce was already consumed (replay). */
  isUsed(nonce: string): boolean {
    return this.used.has(nonce);
  }

  /**
   * Consume a nonce. Returns false if already used (caller should 409).
   * Returns undefined metadata if the nonce was never issued.
   */
  consume(nonce: string): { ok: true; meta: { amount: string; receiver: string; resource: string } } | { ok: false; reason: "replay" | "unknown" } {
    if (this.used.has(nonce)) {
      return { ok: false, reason: "replay" };
    }
    const meta = this.issued.get(nonce);
    if (!meta) {
      return { ok: false, reason: "unknown" };
    }
    this.issued.delete(nonce);
    this.used.add(nonce);
    return { ok: true, meta };
  }

  clear(): void {
    this.used.clear();
    this.issued.clear();
  }

  get sizeUsed(): number {
    return this.used.size;
  }
}
