import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, tokenizeJoined, TOKENIZER_VERSION } from '../../src/index/tokenizer.ts';

test('S3.2 CJK runs become bigrams', () => {
  assert.deepEqual(tokenize('安装工具链'), ['安装', '装工', '工具', '具链']);
  assert.deepEqual(tokenize('错'), ['错']);
  assert.equal(TOKENIZER_VERSION, 1);
});

test('S3.2 mixed Chinese and English keeps both sides', () => {
  assert.deepEqual(tokenize('Windows 安装工具'), ['windows', '安装', '装工', '工具']);
});

test('S3.2 error codes stay whole and also split', () => {
  assert.deepEqual(tokenize('E-1234'), ['e-1234', 'e', '1234']);
  assert.deepEqual(tokenize('path/to/file.md'), ['path/to/file.md', 'path', 'to', 'file', 'md']);
});

test('S3.2 NFKC folds full-width characters', () => {
  assert.deepEqual(tokenize('ＡＢＣ１２３'), ['abc123']);
  assert.equal(tokenizeJoined('安装 DSH 插件'), '安装 dsh 插件');
});

test('S3.2 bigrams vs Intl.Segmenter is recorded for the ADR', () => {
  const text = '安装原生模块前先确认工具链';
  const bigrams = tokenize(text).length;
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  const words = [...segmenter.segment(text)].filter((part) => part.isWordLike).length;
  // Bigrams are deliberately denser than word segmentation: this is the
  // trade-off recorded in ADR-0007 (bigram recall vs index size).
  assert.ok(bigrams > words);
});
