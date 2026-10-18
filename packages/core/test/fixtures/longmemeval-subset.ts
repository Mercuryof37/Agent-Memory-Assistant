import type { Kind, MemoryDoc } from '../../src/model/types.ts';
import type { LongMemQuery } from '../../src/eval/longmem.ts';

/**
 * A small, hand-authored LongMemEval-style subset (V4.0-S2c).
 *
 * It is *not* the official LongMemEval dataset; it mirrors its question shapes
 * so the retrieval loop can be exercised offline:
 * - single-session user / assistant facts
 * - multi-session composition
 * - temporal current-state and knowledge update
 * - abstention (no answer in memory)
 *
 * The fixture is data, not truth. Floors live in `docs/eval/s2c-thresholds.json`.
 */

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1);
const DATE = (offset: number): string => new Date(BASE + offset * DAY).toISOString().slice(0, 10);
const TS = (offset: number): string => new Date(BASE + offset * DAY).toISOString();

function id(seed: number): string {
  return `mem-20260901-${seed.toString(16).padStart(8, '0')}`;
}

function doc(
  seed: number,
  kind: Kind,
  abstract: string,
  body: string,
  options: { from?: number; until?: number; project?: string; tags?: string[]; error_signatures?: string[] } = {},
): MemoryDoc {
  const from = options.from ?? 0;
  const until = options.until;
  return {
    id: id(seed),
    mem_schema: 2,
    kind,
    scope: 'local',
    project: options.project ?? 'Personal',
    tags: options.tags ?? [],
    relations: [],
    abstract,
    created_at: TS(from),
    valid_from: DATE(from),
    valid_until: until === undefined ? null : DATE(until),
    supersedes: [],
    author: 'human',
    evidence_level: 'user_confirmed',
    error_signatures: options.error_signatures ?? [],
    provenance: [],
    body: `${body}\n`,
    file_path: `${id(seed)}.md`,
    content_hash: 'a'.repeat(64),
  };
}

export const LONG_MEM_MEMORIES: readonly MemoryDoc[] = [
  doc(1, 'fact', '用户偏好使用 pnpm，不用 npm', '项目安装统一用 pnpm；npm 只用来查看 registry。', { tags: ['preference'] }),
  doc(2, 'fact', '用户的狗叫 Mochi', 'Mochi 是一只柴犬，住在杭州。', { tags: ['personal'] }),
  doc(3, 'exp', '本机没有 PowerShell 7，使用 powershell.exe', '命令示例不要用 pwsh；沙箱内不要改 DACL。', { tags: ['windows'] }),
  doc(4, 'fact', 'Agent Memory 的 npm scope 是 agent_memory', '包名 @agent_memory/dsh；npm 组织用下划线。', { project: 'Agent Memory', tags: ['release'] }),
  doc(5, 'exp', 'ONNX 运行时体积太大，sidecar 更合适', 'onnxruntime-node 解包约 301MB；插件包只有 185KB。', { project: 'Agent Memory', tags: ['v4'] }),
  doc(6, 'fact', 'V3 使用 Chrome 风格配色', '浅色 #f8f9fa，主色 #1a73e8。', { project: 'Agent Memory', tags: ['ui'] }),
  doc(7, 'fact', 'V4 使用工作树而不是自由力导向图', '项目为根、关系为跨枝连接，默认深度 1。', { project: 'Agent Memory', tags: ['v4', 'ui'] }),
  doc(8, 'fact', '上一版部署区域是 us-east', '旧配置：region=us-east。', { project: 'Infra', from: 0, until: 20, tags: ['deploy'] }),
  doc(9, 'fact', '当前部署区域是 eu-west', '新配置：region=eu-west，已切换。', { project: 'Infra', from: 20, tags: ['deploy'] }),
  doc(10, 'fact', '数据库迁移在周五晚上进行', '迁移脚本先备份，再跑 rebuild。', { project: 'Infra', tags: ['deploy'] }),
  doc(11, 'exp', '写记忆前必须先读最新条目', '替换要给完整条目，避免重复或矛盾。', { project: 'Agent Memory', tags: ['rules'] }),
  doc(12, 'pitfall', 'esbuild 在 Linux 的二进制在 bin 下', '路径是 @esbuild/linux-x64/bin/esbuild，不在包根。', { project: 'Agent Memory', tags: ['ci'], error_signatures: ['esbuild binary not found'] }),
  doc(13, 'fact', '项目代号是 Atlas', 'Atlas 是内部代号，对外叫 Agent Memory。', { project: 'Agent Memory', tags: ['naming'] }),
  doc(14, 'fact', 'Atlas 的截止日期是 2026-10-31', '里程碑：V4.0 在 10 月底前完成。', { project: 'Agent Memory', tags: ['planning'] }),
  doc(15, 'fact', '每周一上午十点站会', '团队同步放在周一 10:00。', { project: 'Personal', tags: ['calendar'] }),
  doc(16, 'fact', '用户不喝咖啡，只喝茶', '偏好龙井，不加糖。', { tags: ['personal'] }),
  doc(17, 'exp', '发布失败先看具体步骤，不要只看退出码', 'CI 摘要只给 exit 1；要点开失败步骤。', { project: 'Agent Memory', tags: ['ci'] }),
  doc(18, 'fact', '工作树最多三层', '项目 → 主题 → 记忆；再深进详情。', { project: 'Agent Memory', tags: ['v4', 'ui'] }),
  doc(19, 'fact', 'LongMemEval 用来评估长期记忆', '包含单会话、多会话、时序、知识更新与弃答。', { project: 'Agent Memory', tags: ['eval'] }),
  doc(20, 'fact', 'Mochi 的生日是 2023-03-15', '每年 3 月 15 日。', { tags: ['personal'] }),
  doc(21, 'fact', '用户住在杭州西湖区', '通勤靠地铁。', { tags: ['personal'] }),
  doc(22, 'fact', '旧的项目代号是 Beacon', 'Beacon 已废弃，改名为 Atlas。', { project: 'Agent Memory', from: 0, until: 15, tags: ['naming'] }),
  doc(23, 'fact', '新项目代号是 Atlas', 'Beacon 在 9 月 16 日改名为 Atlas。', { project: 'Agent Memory', from: 15, tags: ['naming'] }),
  doc(24, 'exp', '中文检索用二元组效果稳定', 'CJK bigram 比按字切分更稳。', { project: 'Agent Memory', tags: ['eval', 'search'] }),
];

export const LONG_MEM_QUERIES: readonly LongMemQuery[] = [
  { id: 'L1', category: 'single_session_user', query: '用户喜欢用什么包管理器？', expected: id(1) },
  { id: 'L2', category: 'single_session_user', query: '用户的狗叫什么名字？', expected: id(2) },
  { id: 'L3', category: 'single_session_assistant', query: 'ONNX 运行时为什么用 sidecar？', expected: id(5) },
  { id: 'L4', category: 'multi_session', query: 'Atlas 的截止日期是什么时候？', expected: id(14) },
  { id: 'L5', category: 'temporal', query: '当前部署区域是哪里？', expected: id(9) },
  { id: 'L6', category: 'temporal', query: '2026-09-10 时部署区域是哪里？', expected: id(8), asOf: DATE(10) },
  { id: 'L7', category: 'knowledge_update', query: '项目现在的代号是什么？', expected: id(23) },
  { id: 'L8', category: 'knowledge_update', query: '项目之前的代号是什么？', expected: id(22), asOf: DATE(10) },
  { id: 'L9', category: 'abstention', query: '量子色动力学的耦合常数是多少？', expected: null },
  { id: 'L10', category: 'abstention', query: '火星殖民地的氧气价格是多少？', expected: null },
];
