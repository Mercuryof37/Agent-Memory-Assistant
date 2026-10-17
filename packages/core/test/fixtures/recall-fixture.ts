import type { Kind, MemoryDoc } from '../../src/model/types.ts';
import type { EvalQuery } from '../../src/eval/evaluate.ts';

/**
 * S3 recall fixture: 60 memories, 16 queries (12 dev / 4 held-out).
 *
 * Coverage on purpose: synonyms, mixed Chinese/English, error codes, validity
 * boundaries, supersede conflicts and no-answer queries. The fixture is data,
 * not truth: it exists to keep the ADR-0007 floor honest.
 */

interface Topic {
  readonly zh: string;
  readonly en: string;
  readonly code?: string;
}

const TOPICS: readonly Topic[] = [
  { zh: 'Windows 原生模块构建', en: 'native module build tools', code: 'MSB8020' },
  { zh: 'journal 哈希链', en: 'hash chain append only', code: 'JRN001' },
  { zh: '写锁租约', en: 'lock lease heartbeat', code: 'LOCK001' },
  { zh: 'frontmatter 每行 JSON', en: 'frontmatter JSON per line', code: 'FM001' },
  { zh: 'BM25 字段加权', en: 'BM25 weighted fields', code: 'BM25001' },
  { zh: '中文二元组分词', en: 'CJK bigram tokenizer', code: 'TOK001' },
  { zh: '会话快照冻结', en: 'session snapshot freeze', code: 'SNP001' },
  { zh: '封存文件哈希', en: 'sealed file hash', code: 'SEAL001' },
  { zh: '手放文件入账', en: 'adopt hand placed file', code: 'ADP001' },
  { zh: '删除只写 journal', en: 'delete journal only', code: 'DEL001' },
  { zh: '注入转义分隔符', en: 'injection escape delimiter', code: 'ESC001' },
  { zh: '规则逐条渲染', en: 'rules numbered render', code: 'RUL001' },
  { zh: 'DSH rc.2 兼容', en: 'desktop rc.2 compatibility', code: 'RC2001' },
  { zh: 'fsync 与 rename', en: 'fsync rename directory entry', code: 'FSY001' },
  { zh: 'T0 配额', en: 'T0 quota per session', code: 'QUO001' },
  { zh: '提案 base_hash', en: 'proposal base hash', code: 'PRP001' },
  { zh: 'MEMORY.md 目录', en: 'catalog deterministic trim', code: 'CAT001' },
  { zh: '错误码整体保留', en: 'error code preserved', code: 'ERR404' },
  { zh: '有效期边界', en: 'validity boundary date', code: 'TIME01' },
  { zh: '冲突记忆替代', en: 'supersede conflict chain', code: 'CONF01' },
];

function idFor(topic: number, variant: number): string {
  return `mem-20261017-${(topic * 3 + variant).toString(16).padStart(8, '0')}`;
}

function base(topic: number, variant: number): Omit<MemoryDoc, 'kind' | 'abstract' | 'body' | 'error_signatures' | 'content_hash'> {
  const recent = topic >= 10;
  return {
    id: idFor(topic, variant),
    mem_schema: 1,
    scope: 'local',
    created_at: recent ? '2026-10-01T00:00:00+00:00' : '2026-01-01T00:00:00+00:00',
    valid_from: recent ? '2026-10-01' : '2026-01-01',
    valid_until: null,
    supersedes: [],
    author: 'human',
    evidence_level: 'user_confirmed',
    provenance: [],
    file_path: `${idFor(topic, variant)}.md`,
  };
}

function contentHash(seed: string): string {
  let hash = '';
  for (let index = 0; index < 64; index += 1) {
    hash += '0123456789abcdef'[(seed.charCodeAt(index % seed.length) + index) % 16];
  }
  return hash;
}

function makeDoc(
  topic: number,
  variant: number,
  kind: Kind,
  abstract: string,
  body: string,
  signatures: readonly string[] = [],
): MemoryDoc {
  return {
    ...base(topic, variant),
    kind,
    abstract,
    body,
    error_signatures: signatures,
    content_hash: contentHash(`${topic}-${variant}-${kind}`),
  };
}

export const EVAL_MEMORIES: readonly MemoryDoc[] = TOPICS.flatMap((topic, index) => {
  const docs = [
    makeDoc(index, 0, 'fact', `${topic.zh}：${topic.en} 的稳定做法`, `${topic.en} works when ${topic.zh} is configured first.`),
    makeDoc(
      index,
      1,
      'pitfall',
      `${topic.zh} 的常见错误`,
      `When ${topic.zh} fails, check the documented order before retrying.`,
      topic.code === undefined ? [] : [topic.code],
    ),
    makeDoc(index, 2, 'exp', `${topic.zh} 的经验`, `${topic.en} experience note; keep the evidence and the error code together.`),
  ];
  // Time boundary: this experience expires in March; queries after that must not
  // see it, queries in February must.
  if (index === 18) {
    return [
      ...docs.slice(0, 2),
      { ...(docs[2] as MemoryDoc), valid_from: '2026-01-01', valid_until: '2026-03-01' },
    ];
  }
  // Conflict: the newer experience supersedes the older fact of the same topic.
  if (index === 19) {
    const fact = docs[0] as MemoryDoc;
    const exp = docs[2] as MemoryDoc;
    return [{ ...fact, supersedes: [] }, docs[1] as MemoryDoc, { ...exp, supersedes: [fact.id] }];
  }
  return docs;
});

export const EVAL_QUERIES: readonly EvalQuery[] = [
  { id: 'dev-1', split: 'dev', query: 'Windows 原生模块构建', expected: idFor(0, 0), kind: 'fact' },
  { id: 'dev-2', split: 'dev', query: 'hash chain append only', expected: idFor(1, 0), kind: 'fact' },
  { id: 'dev-3', split: 'dev', query: '写锁租约 heartbeat', expected: idFor(2, 0), kind: 'fact' },
  { id: 'dev-4', split: 'dev', query: 'frontmatter JSON per line', expected: idFor(3, 0), kind: 'fact' },
  { id: 'dev-5', split: 'dev', query: 'BM25001', expected: idFor(4, 1), kind: 'pitfall' },
  { id: 'dev-6', split: 'dev', query: 'CJK bigram tokenizer', expected: idFor(5, 0), kind: 'fact' },
  { id: 'dev-7', split: 'dev', query: '会话快照冻结', expected: idFor(6, 0), kind: 'fact' },
  { id: 'dev-8', split: 'dev', query: 'sealed file hash', expected: idFor(7, 0), kind: 'fact' },
  { id: 'dev-9', split: 'dev', query: 'MSB8020', expected: idFor(0, 1), kind: 'pitfall' },
  { id: 'dev-10', split: 'dev', query: 'DSH rc.2 compatibility', expected: idFor(12, 0), kind: 'fact' },
  {
    id: 'dev-11',
    split: 'dev',
    query: '有效期边界',
    asOf: '2026-02-01',
    expected: idFor(18, 2),
    kind: 'exp',
  },
  { id: 'dev-12', split: 'dev', query: '量子纠缠退相干实验', expected: null },
  { id: 'heldout-1', split: 'heldout', query: 'delete journal only', expected: idFor(9, 0), kind: 'fact' },
  { id: 'heldout-2', split: 'heldout', query: 'T0 配额', expected: idFor(14, 0), kind: 'fact' },
  { id: 'heldout-3', split: 'heldout', query: '南极洲板块漂移速率', expected: null },
  { id: 'heldout-4', split: 'heldout', query: '过期条目查询', expected: null },
];
