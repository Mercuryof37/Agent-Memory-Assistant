/** Synchronous sleep for retry loops; avoids busy-waiting. */
export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}
