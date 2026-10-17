import type { PersonalizationMode } from './mode.ts';

/**
 * `MEMORY_GUIDANCE` section (architecture v2, P3). Short, mode-aware instructions
 * that tell the model how to use the memory surfaces. It is injected right after
 * SOUL and kept inside the guidance budget.
 */

export function renderGuidance(mode: PersonalizationMode): string {
  const modeLine =
    mode === 'direct'
      ? '- 自主判断并直接写入，无需先征得同意；仍必须保留出处。'
      : mode === 'readonly'
        ? '- 只读：不得新增、修改或删除记忆与偏好；需要时把建议交给用户。'
        : '- 新增、修改或删除记忆与偏好前，先用确认卡片取得用户同意；被拒绝就不写。';
  return [
    '## 记忆与方法复用',
    '- 偏好写 USER，事实与经验写记忆，约定写 RULES，可复用方法用 skills。',
    '- 修改前先读最新条目；替换要给完整条目，避免重复或矛盾。',
    '- 只通过工具写入，不绕过；写入必须引用真实事件出处。',
    modeLine,
    '- 子 agent 只读。',
  ].join('\n');
}
