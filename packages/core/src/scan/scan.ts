/**
 * Content scanning (plan v1.3 §6.4). Cannot be disabled.
 *
 * Findings carry only a rule id and a field name, never the matched text, so a
 * rejection cannot echo a secret into logs or the journal.
 */

export type ScanRule = 'invisible' | 'credentials' | 'injection' | 'private_tag';

export interface ScanFinding {
  readonly rule: ScanRule;
  readonly field: string;
}

export class ScanError extends Error {
  readonly findings: readonly ScanFinding[];
  constructor(findings: readonly ScanFinding[]) {
    super(`content rejected by scan: ${findings.map((finding) => `${finding.rule}@${finding.field}`).join(', ')}`);
    this.name = 'ScanError';
    this.findings = findings;
  }
}

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;
const CREDENTIALS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@/i,
];
const INJECTION = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /忽略(之前|以上|前面)(的)?(所有)?(指令|指示)/,
  /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
];
const PRIVATE_TAG = /<private>[\s\S]*?<\/private>/i;

export function scanText(field: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (INVISIBLE.test(text)) findings.push({ rule: 'invisible', field });
  if (CREDENTIALS.some((pattern) => pattern.test(text))) findings.push({ rule: 'credentials', field });
  if (INJECTION.some((pattern) => pattern.test(text))) findings.push({ rule: 'injection', field });
  if (PRIVATE_TAG.test(text)) findings.push({ rule: 'private_tag', field });
  return findings;
}

export interface ScannableInput {
  readonly abstract?: string;
  readonly body?: string;
  readonly error_signatures?: readonly string[];
  readonly quote?: string;
  readonly targets?: readonly string[];
}

/** Scan every field that can reach a file, the journal or the prompt. */
export function scanInput(input: ScannableInput): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (input.abstract !== undefined) findings.push(...scanText('abstract', input.abstract));
  if (input.body !== undefined) findings.push(...scanText('body', input.body));
  if (input.quote !== undefined) findings.push(...scanText('quote', input.quote));
  input.error_signatures?.forEach((signature, index) =>
    findings.push(...scanText(`error_signatures[${index}]`, signature)),
  );
  input.targets?.forEach((target, index) => findings.push(...scanText(`targets[${index}]`, target)));
  return findings;
}

export function assertClean(input: ScannableInput): void {
  const findings = scanInput(input);
  if (findings.length > 0) throw new ScanError(findings);
}

/** T1 path: `<private>…</private>` is not silently stripped; it becomes redacted text. */
export function redactPrivate(text: string): string {
  return text.replace(PRIVATE_TAG, '[private]');
}
