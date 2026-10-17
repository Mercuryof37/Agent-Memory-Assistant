import { randomBytes } from 'node:crypto';

/** `mem-YYYYMMDD-8hex`; generated server-side, never accepted from a model. */
const ID_PATTERN = /^mem-\d{8}-[0-9a-f]{8}$/;

export function isMemoryId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function newMemoryId(now: Date = new Date(), bytes: () => Buffer = () => randomBytes(4)): string {
  return `mem-${formatDate(now).replaceAll('-', '')}-${bytes().toString('hex')}`;
}
