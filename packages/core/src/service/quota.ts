/** Per-session T0 write budget (plan v1.3 §5.4). In memory on purpose: a crash
 * resets the counter, which can only make the agent ask for a proposal sooner. */
export class SessionQuota {
  private readonly used = new Map<string, number>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** Consume one T0 write; returns false when the session budget is exhausted. */
  consume(sessionId: string): boolean {
    const count = this.used.get(sessionId) ?? 0;
    if (count >= this.limit) return false;
    this.used.set(sessionId, count + 1);
    return true;
  }

  usedOf(sessionId: string): number {
    return this.used.get(sessionId) ?? 0;
  }
}
