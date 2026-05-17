/**
 * Semaphore — caps the number of in-flight async jobs at `max`.
 *
 * Why this exists, even though PR 12's cron doesn't use it:
 *
 *   When PR 13 wires the worker's /webhook receive path, a burst of
 *   N Meta webhook deliveries would fan out to N simultaneous OpenAI
 *   calls if the receive handler awaits the bot turn inline. That
 *   floods two limits at once:
 *
 *     - the pg pool (max ~10 connections per process), and
 *     - the OpenAI per-tenant RPM cap.
 *
 *   The Semaphore queues acquisitions past `max` so effective
 *   concurrency stays bounded under burst load. Phase 2 D-5.
 *
 * DEFAULT_MAX = 8 is a starting point — refine after load testing in
 * PR 13. Override via the constructor argument when wiring is added.
 *
 * Shape (acquire/release/drain) is what PR 13's webhook handler will
 * consume — added now so PR 13 lands cleanly without restructuring
 * this module.
 */

export const DEFAULT_MAX = 8;

export class Semaphore {
  private inflight = 0;
  private readonly queue: Array<() => void> = [];
  private closed = false;
  private readonly max: number;

  constructor(max: number = DEFAULT_MAX) {
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error('Semaphore: max must be a positive number');
    }
    this.max = max;
  }

  /**
   * Acquire a slot. Resolves with a release function — call it exactly
   * once when the protected work is done. Throws if the semaphore has
   * been closed via drain().
   */
  async acquire(): Promise<() => void> {
    if (this.closed) {
      throw new Error('Semaphore closed — not accepting new acquisitions');
    }
    if (this.inflight < this.max) {
      this.inflight++;
      return () => this.releaseOnce();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.inflight++;
        resolve(() => this.releaseOnce());
      });
    });
  }

  private releaseOnce(): void {
    // Defensive: ignore double-release. Caller-style guards usually
    // make this unreachable; cheap to enforce.
    if (this.inflight <= 0) return;
    this.inflight--;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Stop accepting new acquisitions, then wait for in-flight to drain.
   * Returns true if drained within timeoutMs, false if still in-flight
   * at timeout. Safe to call multiple times.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.closed = true;
    const start = Date.now();
    while (this.inflight > 0) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  }

  get inflightCount(): number {
    return this.inflight;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}
