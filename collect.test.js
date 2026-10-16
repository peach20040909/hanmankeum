import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAI, ruleClassify, needsReview } from './collect.js';

test('AI 사용 감지', () => {
  assert.equal(detectAI({ title: 'feat: 로그인', body: 'Co-authored-by: Kim <k@x.com>\nCo-authored-by: Claude <noreply@anthropic.com>' }).ai, true);
  assert.equal(detectAI({ title: '[AI] 요약 정리', body: '' }).note, '작성자가 AI 사용을 표시');
  assert.equal(detectAI({ title: 'fix: 오타', body: 'Co-authored-by: Kim <k@x.com>' }).ai, false); // 사람 공동 작성자는 아님
  assert.equal(detectAI({ title: '요구사항 정리', body: '' }).ai, false);
});

test('AI·규칙 판단이 다르면 확인 필요, 교수가 확인하면 해제', () => {
  const r = { classified_by: 'ai', type: 0, rule_type: ruleClassify({ kind: '문서 편집', title: '요구사항 정리' }).type };
  assert.equal(needsReview(r), true);
  assert.equal(needsReview({ ...r, classified_by: 'professor' }), false);
  assert.equal(needsReview({ ...r, classified_by: 'rule', rule_type: 0 }), false);
});
