import { randomUUID } from 'node:crypto';
import { copyFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

/**
 * Repair stored DSH session logs whose `user/message` events violate the replay
 * contract (missing `id` and/or a role other than `user`).
 *
 * Why this exists: `Session#append()` validates event data but not message
 * identity, while replay (`assertSessionEventShape` via `adoptSessionEvent`)
 * requires every message event to carry a non-empty `id` whose role matches the
 * event type. One producer that appends an anonymous message therefore writes a
 * log that loads in the live turn and refuses to open afterwards.
 *
 * The physical format is a concatenated Zstandard stream: the first frame holds
 * exactly one header line and every later frame holds one or more JSONL lines.
 * This module preserves the original header frame byte for byte and re-encodes
 * the remaining lines in fixed-size runs.
 */

const ZSTD_MAGIC = 0xfd2fb528;
const LINES_PER_FRAME = 16;

/**
 * Split a concatenated Zstandard stream into frame buffers by walking each
 * frame header and block list (scanning for the magic would also match payload
 * bytes).
 * @param {Buffer} buffer - the whole stored log.
 * @returns {Buffer[]} one buffer per frame.
 */
export function splitZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const length = zstdFrameLength(buffer, offset);
    frames.push(buffer.subarray(offset, offset + length));
    offset += length;
  }
  if (frames.length === 0) throw new Error('session log has no Zstandard frame');
  return frames;
}

/**
 * Return the byte length of the Zstandard frame starting at `offset`.
 * @param {Buffer} buffer - containing buffer.
 * @param {number} offset - frame start.
 * @returns {number} frame length.
 */
function zstdFrameLength(buffer, offset) {
  const torn = (what) => new Error(`corrupt Zstandard session log: torn ${what} at byte ${offset}`);
  let cursor = offset;
  if (buffer.length - cursor < 5) throw torn('frame header');
  if (buffer.readUInt32LE(cursor) !== ZSTD_MAGIC) {
    throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${cursor}`);
  }
  cursor += 4;
  const descriptor = buffer.readUInt8(cursor);
  cursor += 1;
  if ((descriptor & 0x18) !== 0) {
    throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${cursor - 1}`);
  }
  const contentSizeFlag = descriptor >>> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const hasChecksum = (descriptor & 0x04) !== 0;
  const dictionaryFlag = descriptor & 0x03;

  if (!singleSegment) cursor += 1;
  cursor += dictionaryFlag === 3 ? 4 : dictionaryFlag;
  cursor += singleSegment
    ? [1, 2, 4, 8][contentSizeFlag]
    : [0, 2, 4, 8][contentSizeFlag];
  if (cursor > buffer.length) throw torn('frame header');

  for (;;) {
    if (buffer.length - cursor < 3) throw torn('block header');
    const header = buffer[cursor] | (buffer[cursor + 1] << 8) | (buffer[cursor + 2] << 16);
    cursor += 3;
    const last = (header & 1) !== 0;
    const type = (header >>> 1) & 0x03;
    const size = header >>> 3;
    if (type === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${cursor - 3}`);
    cursor += type === 1 ? 1 : size;
    if (cursor > buffer.length) throw torn('block payload');
    if (last) break;
  }
  if (hasChecksum) cursor += 4;
  if (cursor > buffer.length) throw torn('frame checksum');
  return cursor - offset;
}

/**
 * Decode a concatenated session log into its header line and event lines.
 * @param {Buffer} buffer - the stored artifact.
 * @returns {{ headerLine: string, eventLines: string[], headerFrame: Buffer }} decoded parts.
 */
export function decodeSessionLog(buffer) {
  const frames = splitZstdFrames(buffer);
  const headerFrame = frames[0];
  const headerText = zlib.zstdDecompressSync(headerFrame).toString('utf8');
  if (!headerText.endsWith('\n') || headerText.indexOf('\n') !== headerText.length - 1) {
    throw new Error('corrupt session log: first frame is not exactly one header line');
  }
  const headerLine = headerText.slice(0, -1);
  const header = parseLine(headerLine, 'header');
  if (header.type !== 'session') throw new Error('corrupt session log: first line is not the session header');

  const text = frames.slice(1).map((frame) => zlib.zstdDecompressSync(frame).toString('utf8')).join('');
  const eventLines = text.split('\n');
  if (eventLines.length > 0 && eventLines[eventLines.length - 1] === '') eventLines.pop();
  return { headerLine, eventLines, headerFrame };
}

/**
 * Re-encode decoded lines, keeping the header frame byte for byte.
 * @param {Buffer} headerFrame - original first frame.
 * @param {string[]} eventLines - JSONL event lines without trailing newlines.
 * @returns {Buffer} the stored artifact.
 */
export function encodeSessionLog(headerFrame, eventLines) {
  const frames = [headerFrame];
  for (let index = 0; index < eventLines.length; index += LINES_PER_FRAME) {
    const chunk = eventLines.slice(index, index + LINES_PER_FRAME).join('\n') + '\n';
    frames.push(zlib.zstdCompressSync(Buffer.from(chunk, 'utf8')));
  }
  return Buffer.concat(frames);
}

/**
 * Patch one parsed event, when it is a user message that replay would reject.
 * @param {Record<string, any>} event - parsed event.
 * @param {() => string} nextId - identity factory, called only when an id is missing.
 * @returns {string[]} applied fixes, empty when the event is already valid.
 */
export function repairEvent(event, nextId) {
  if (event.type !== 'user/message') return [];
  const data = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`user/message at seq ${String(event.seq)} has a non-object data payload`);
  }
  const fixes = [];
  if (typeof data.id !== 'string' || data.id === '') {
    data.id = nextId();
    fixes.push('id');
  }
  if (data.role !== 'user') {
    fixes.push(`role:${String(data.role)}->user`);
    data.role = 'user';
  }
  if (typeof data.content !== 'object' || !Array.isArray(data.content)) {
    throw new Error(`user/message at seq ${String(event.seq)} has no content array; not a repairable identity defect`);
  }
  if (typeof data.source !== 'object' || data.source === null) {
    throw new Error(`user/message at seq ${String(event.seq)} has no source object; not a repairable identity defect`);
  }
  return fixes;
}

/**
 * Repair every user message in a decoded log.
 * @param {string[]} eventLines - original event lines.
 * @param {() => string} nextId - identity factory.
 * @returns {{ lines: string[], changes: Array<{ seq: unknown, fixes: string[] }> }} repaired log.
 */
export function repairSessionEvents(eventLines, nextId = randomUUID) {
  const changes = [];
  const lines = eventLines.map((line) => {
    const event = parseLine(line, 'event');
    const fixes = repairEvent(event, nextId);
    if (fixes.length === 0) return line;
    changes.push({ seq: event.seq, type: event.type, fixes });
    return JSON.stringify(event);
  });
  return { lines, changes };
}

/**
 * Parse one JSONL line with a diagnostic that names the line kind.
 * @param {string} line - JSON text.
 * @param {string} kind - subject used in the error.
 * @returns {Record<string, any>} parsed value.
 */
function parseLine(line, kind) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`corrupt session log: ${kind} line is not JSON (${String(error)})`);
  }
}

/**
 * Verify a repaired artifact round-trips and carries no unidentified message.
 * @param {Buffer} buffer - encoded artifact.
 * @param {number} expectedLines - expected event-line count.
 * @returns {void}
 */
function assertRepaired(buffer, expectedLines) {
  const decoded = decodeSessionLog(buffer);
  if (decoded.eventLines.length !== expectedLines) {
    throw new Error(`repair verification failed: wrote ${decoded.eventLines.length} events, expected ${expectedLines}`);
  }
  for (const line of decoded.eventLines) {
    const event = parseLine(line, 'event');
    if (event.type !== 'user/message') continue;
    if (typeof event.data?.id !== 'string' || event.data.id === '') {
      throw new Error(`repair verification failed: seq ${String(event.seq)} still lacks an identified message`);
    }
    if (event.data.role !== 'user') {
      throw new Error(`repair verification failed: seq ${String(event.seq)} still has role ${String(event.data.role)}`);
    }
  }
}

/**
 * Repair one stored session log.
 * @param {string} path - artifact path (`session.v4.jsonl.zstd`).
 * @param {{ apply?: boolean, stamp?: string }} [options] - dry run unless `apply`.
 * @returns {{ path: string, changes: Array<{ seq: unknown, fixes: string[] }>, applied: boolean, backup?: string }} outcome.
 */
export function repairSessionLog(path, options = {}) {
  const apply = options.apply === true;
  const stamp = options.stamp ?? timestamp(new Date());
  const buffer = readFileSync(path);
  const { eventLines, headerFrame } = decodeSessionLog(buffer);
  const { lines, changes } = repairSessionEvents(eventLines);
  if (changes.length === 0) return { path, changes, applied: false };

  const encoded = encodeSessionLog(headerFrame, lines);
  assertRepaired(encoded, lines.length);
  if (!apply) return { path, changes, applied: false };

  const backup = `${path}.bak-${stamp}`;
  copyFileSync(path, backup);
  const temporary = `${path}.repair-${process.pid}`;
  try {
    writeFileSync(temporary, encoded);
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // the rename never happened; leave the original artifact untouched
    }
    throw error;
  }
  return { path, changes, applied: true, backup };
}

/**
 * Format a filesystem-safe backup stamp.
 * @param {Date} date - local time.
 * @returns {string} `YYYYMMDD-HHmmss`.
 */
export function timestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
