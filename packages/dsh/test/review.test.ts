import test from 'node:test';
import assert from 'node:assert/strict';
import type { Proposal } from '../../core/src/proposals/proposals.ts';
import {
  buildReviewQuestion,
  decisionFromAnswer,
  formatBody,
  reviewProposal,
  REVIEW_LABELS,
  type CommandsExecutorLike,
  type ReviewDeps,
  type UserQuestionsLike,
} from '../src/review.ts';

const PROPOSAL = {
  id: 'prop-mem-20261017-00000001',
  op: 'supersede',
  targets: ['mem-20261017-00000002'],
  base_hashes: ['a'.repeat(64)],
  replacements: [
    {
      kind: 'fact',
      abstract: '新的结论',
      body: '这是替换后的正文。',
      evidence_level: 'observed',
      provenance: [
        {
          session_id: 'session-test',
          event_seq: 7,
          speaker: 'user',
          quote: '原话',
          event_sha256: 'b'.repeat(64),
        },
      ],
    },
  ],
  reason: '用户纠正了旧结论',
  created_at: '2026-10-17T00:00:00.000Z',
} as unknown as Proposal;

function fakeQuestions(answer: {
  answers: { id: string; selected: string[]; custom?: string }[];
}): { service: UserQuestionsLike; requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    service: {
      ask: async (request) => {
        requests.push(request);
        return answer;
      },
    },
  };
}

function fakeCommands(): { service: CommandsExecutorLike; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    service: {
      execute: async (_agent, line) => {
        lines.push(line);
        return { result: { kind: 'success', text: `已执行 ${line}` } };
      },
    },
  };
}

function deps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return { store: {} as never, config: {} as never, home: '.', ...overrides };
}

test('S9.1 the card shows the proposal content and three Chinese choices', () => {
  const question = buildReviewQuestion(PROPOSAL);
  assert.equal(question.header, '记忆提案');
  assert.match(question.question, /是否采纳提案 prop-mem-20261017-00000001/);
  assert.match(question.detail, /新的结论/);
  assert.match(question.detail, /这是替换后的正文/);
  assert.match(question.detail, /用户纠正了旧结论/);
  assert.match(question.detail, /出处/);
  assert.deepEqual(
    question.options.map((option) => option.label),
    [REVIEW_LABELS.accept, REVIEW_LABELS.reject, REVIEW_LABELS.defer],
  );
});

test('S9.3 inline enumerations get their own lines in the card', () => {
  const proposal = {
    ...PROPOSAL,
    replacements: [
      {
        kind: 'fact',
        abstract: '编号正文',
        body: '1) 第一件事；2) 第二件事；3) 第三件事。总结一句。',
        evidence_level: 'observed',
      },
    ],
  } as unknown as Proposal;
  const detail = buildReviewQuestion(proposal).detail;
  assert.match(detail, /1\. 第一件事；\n2\. 第二件事；\n3\. 第三件事。/);
  assert.match(detail, /总结一句/);
});

test('S9.3 a body without enumerations stays one paragraph', () => {
  assert.equal(formatBody('只有一段普通正文，没有编号。'), '只有一段普通正文，没有编号。');
  assert.equal(formatBody(''), '');
  assert.equal(formatBody('版本 S7.5 不需要拆行。'), '版本 S7.5 不需要拆行。');
});

test('S9.1 采纳 asks with the calling card id and runs /mem decide … accept', async () => {
  const questions = fakeQuestions({ answers: [{ id: PROPOSAL.id, selected: [REVIEW_LABELS.accept] }] });
  const commands = fakeCommands();
  const outcome = await reviewProposal(
    deps({ userQuestions: questions.service, commands: commands.service }),
    PROPOSAL,
    { agent: {}, callId: 'call-1' },
  );
  assert.equal(outcome.decision, 'accept');
  assert.equal(outcome.command, `/mem decide ${PROPOSAL.id} accept`);
  assert.deepEqual(commands.lines, [`/mem decide ${PROPOSAL.id} accept`]);
  assert.match(outcome.message, /已执行/);
  const request = questions.requests[0] as { wait: { callId: string } };
  assert.equal(request.wait.callId, 'call-1');
});

test('S9.1 驳回 converts to reject; 暂不处理 and free text defer without a command', async () => {
  const reject = fakeQuestions({ answers: [{ id: PROPOSAL.id, selected: [REVIEW_LABELS.reject] }] });
  const rejectCommands = fakeCommands();
  const rejected = await reviewProposal(
    deps({ userQuestions: reject.service, commands: rejectCommands.service }),
    PROPOSAL,
    { agent: {}, callId: 'call-2' },
  );
  assert.equal(rejected.decision, 'reject');
  assert.deepEqual(rejectCommands.lines, [`/mem decide ${PROPOSAL.id} reject`]);

  const defer = fakeQuestions({ answers: [{ id: PROPOSAL.id, selected: [REVIEW_LABELS.defer] }] });
  const deferCommands = fakeCommands();
  const deferred = await reviewProposal(
    deps({ userQuestions: defer.service, commands: deferCommands.service }),
    PROPOSAL,
    { agent: {}, callId: 'call-3' },
  );
  assert.equal(deferred.decision, 'defer');
  assert.equal(deferred.command, undefined);
  assert.equal(deferCommands.lines.length, 0);

  const custom = fakeQuestions({ answers: [{ id: PROPOSAL.id, selected: [], custom: '先不改' }] });
  assert.equal(
    decisionFromAnswer({ answers: [{ id: PROPOSAL.id, selected: [], custom: '先不改' }] }),
    'defer',
  );
  assert.equal(custom.requests.length, 0);
});

test('S9.1 no interaction surface leaves the proposal pending instead of deciding', async () => {
  const outcome = await reviewProposal(deps(), PROPOSAL, { agent: {}, callId: 'call-4' });
  assert.equal(outcome.decision, 'defer');
  assert.match(outcome.message, /没有交互界面/);
});

test('S9.1 the review needs a live agent and otherwise stays pending', async () => {
  const questions = fakeQuestions({ answers: [{ id: PROPOSAL.id, selected: [REVIEW_LABELS.accept] }] });
  const outcome = await reviewProposal(deps({ userQuestions: questions.service }), PROPOSAL, undefined);
  assert.equal(outcome.decision, 'defer');
  assert.match(outcome.message, /活动会话/);
  assert.equal(questions.requests.length, 0);
});
