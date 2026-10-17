import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import {
  decodeSessionLog,
  encodeSessionLog,
  repairSessionLog,
  repairSessionEvents,
  splitZstdFrames,
} from '../../../scripts/lib/session-repair.mjs';

/**
 * Recovery contract for stored session logs poisoned by an anonymous
 * `user/message` event: DSH writes such an event (append validates data only)
 * but refuses to re-open the session (replay validates message identity). The
 * repair must add the identity and keep everything else byte-stable.
 */

const HEADER = {
  type: 'session',
  version: 4,
  id: 'session-repair-test',
  createdAt: 1792231843720,
  cwd: 'C:\\tmp',
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: 'standard',
};

function identified(seq: number): string {
  return JSON.stringify({
    type: 'user/message',
    seq,
    time: 1792231846266,
    data: {
      content: [{ type: 'text', text: 'typed by a person' }],
      role: 'user',
      source: { kind: 'user' },
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    },
    surfaceOp: 'append',
  });
}

function anonymous(seq: number, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user/message',
    seq,
    time: 1792231846266,
    data: {
      role: 'user',
      content: [{ type: 'text', text: 'Reply with exactly: am-closeout-ok' }],
      source: { kind: 'user' },
      ...overrides,
    },
    surfaceOp: 'append',
  });
}

function artifact(lines: string[]): Buffer {
  const headerFrame = zlib.zstdCompressSync(Buffer.from(JSON.stringify(HEADER) + '\n'));
  return encodeSessionLog(headerFrame, lines);
}

function fixture(lines: string[]): { dir: string; path: string; original: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'session-repair-'));
  const path = join(dir, 'session.v4.jsonl.zstd');
  const original = artifact(lines);
  writeFileSync(path, original);
  return { dir, path, original };
}

test('the frame walker splits a concatenated stream without trusting magic bytes', () => {
  const lines = [identified(1), identified(2), anonymous(3)];
  const buffer = artifact(lines);
  const frames = splitZstdFrames(buffer);
  assert.ok(frames.length >= 2, 'header frame plus at least one event frame');
  const header = zlib.zstdDecompressSync(frames[0]!).toString('utf8');
  assert.equal(header, JSON.stringify(HEADER) + '\n');
  const decoded = decodeSessionLog(buffer);
  assert.equal(decoded.eventLines.length, lines.length);
});

test('a dry run reports the repairs and leaves the artifact untouched', () => {
  const { dir, path, original } = fixture([identified(1), anonymous(2)]);
  try {
    const outcome = repairSessionLog(path, { apply: false, stamp: 'test' });
    assert.deepEqual(outcome.changes, [{ seq: 2, type: 'user/message', fixes: ['id'] }]);
    assert.equal(outcome.applied, false);
    assert.deepEqual(readFileSync(path), original);
    assert.equal(existsSync(`${path}.bak-test`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applying adds an identity, fixes the role and keeps other events byte-identical', () => {
  const valid = identified(1);
  const { dir, path, original } = fixture([valid, anonymous(2, { role: 'assistant' })]);
  try {
    const outcome = repairSessionLog(path, { apply: true, stamp: 'test' });
    assert.equal(outcome.applied, true);
    assert.deepEqual(outcome.changes, [
      { seq: 2, type: 'user/message', fixes: ['id', 'role:assistant->user'] },
    ]);
    assert.ok(outcome.backup !== undefined);
    assert.deepEqual(readFileSync(outcome.backup), original, 'backup keeps the original bytes');

    const repaired = decodeSessionLog(readFileSync(path));
    assert.equal(repaired.eventLines.length, 2);
    assert.equal(repaired.headerLine, JSON.stringify(HEADER));
    assert.equal(repaired.eventLines[0], valid, 'identified messages stay untouched');

    const event = JSON.parse(repaired.eventLines[1]!);
    assert.equal(event.data.role, 'user');
    assert.match(event.data.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(event.data.content[0].text, 'Reply with exactly: am-closeout-ok');
    assert.equal(event.surfaceOp, 'append');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a log without defects is reported as nothing to repair', () => {
  const { dir, path } = fixture([identified(1), identified(2)]);
  try {
    const outcome = repairSessionLog(path, { apply: true, stamp: 'test' });
    assert.equal(outcome.applied, false);
    assert.deepEqual(outcome.changes, []);
    assert.deepEqual(readdirSync(dir), ['session.v4.jsonl.zstd']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a message that is broken beyond identity is refused, not guessed', () => {
  const broken = JSON.stringify({
    type: 'user/message',
    seq: 2,
    time: 1792231846266,
    data: { role: 'user', source: { kind: 'user' } },
    surfaceOp: 'append',
  });
  assert.throws(
    () => repairSessionEvents([broken]),
    /no content array/,
  );
});
