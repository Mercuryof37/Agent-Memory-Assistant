/**
 * Tokenizer for the in-memory index (plan v1.3 §6.3).
 *
 * NFKC + lower-case; CJK as bigrams; ASCII words; code-shaped fragments keep
 * their whole form and also split on separators. The version is a cache key:
 * changing the rules must invalidate the index.
 */

export const TOKENIZER_VERSION = 1;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const WORD = /[a-z0-9]/;
const WORD_BODY = /[a-z0-9_\-.:/]/;
const SEPARATORS = /[-_.:/]+/;

function isCjk(char: string): boolean {
  return CJK.test(char);
}

export function tokenize(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (isCjk(char)) {
      let end = index;
      while (end < text.length && isCjk(text[end] as string)) end += 1;
      const run = [...text.slice(index, end)];
      if (run.length === 1) {
        tokens.push(run[0] as string);
      } else {
        for (let at = 0; at < run.length - 1; at += 1) {
          tokens.push(`${run[at]}${run[at + 1]}`);
        }
      }
      index = end;
      continue;
    }
    if (WORD.test(char)) {
      let end = index;
      while (end < text.length && WORD_BODY.test(text[end] as string)) end += 1;
      const word = text.slice(index, end);
      if (word !== '') {
        tokens.push(word);
        if (SEPARATORS.test(word)) {
          for (const part of word.split(SEPARATORS)) {
            if (part !== '') tokens.push(part);
          }
        }
      }
      index = end;
      continue;
    }
    index += 1;
  }
  return tokens;
}

/** A compact token string for tests and diagnostics. */
export function tokenizeJoined(input: string): string {
  return tokenize(input).join(' ');
}
