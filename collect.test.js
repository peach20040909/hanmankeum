import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAI, ruleClassify, needsReview, normalizeCriteria, ruleCriteria, splitUnobservable } from './collect.js';
import { criteriaOf } from './handler.js';

const C = [
  { name: '구현', desc: '', weight: 50, keywords: ['구현', 'feat'], kinds: ['Pull request'] },
  { name: '검토', desc: '', weight: 30, keywords: ['수정', 'fix'], kinds: ['코드 리뷰'] },
  { name: '관리', desc: '', weight: 20, keywords: ['회의', '일정'], kinds: ['Issue'] },
];

test('AI 사용 감지', () => {
  assert.equal(detectAI({ title: 'feat: 로그인', body: 'Co-authored-by: Kim <k@x.com>\nCo-authored-by: Claude <noreply@anthropic.com>' }).ai, true);
  assert.equal(detectAI({ title: '[AI] 요약 정리', body: '' }).note, '작성자가 AI 사용을 표시');
  assert.equal(detectAI({ title: 'fix: 오타', body: 'Co-authored-by: Kim <k@x.com>' }).ai, false); // 사람 공동 작성자는 아님
  assert.equal(detectAI({ title: '요구사항 정리', body: '' }).ai, false);
});

test('AI·규칙 판단이 다르면 확인 필요, 교수가 확인하면 해제', () => {
  const r = { classified_by: 'ai', type: 0, rule_type: ruleClassify({ kind: '문서 편집', title: '회의 일정 정리' }, C).type };
  assert.equal(needsReview(r), true);
  assert.equal(needsReview({ ...r, classified_by: 'professor' }), false);
  assert.equal(needsReview({ ...r, classified_by: 'rule', rule_type: 0 }), false);
});

test('교수 기준 규칙 분류: 활동 종류·키워드, 맞는 게 없으면 기준 밖', () => {
  assert.equal(ruleClassify({ kind: '코드 리뷰', title: '리뷰: 로그인' }, C).type, 1);
  assert.equal(ruleClassify({ kind: 'Commit', title: 'feat: 검색 구현' }, C).type, 0);
  assert.equal(ruleClassify({ kind: 'Commit', title: '회의록 오타 fix' }, C).type, 1); // 동점이면 앞 항목
  const out = ruleClassify({ kind: 'Commit', title: 'wip' }, C);
  assert.equal(out.type, null);
  assert.match(out.reason, /기준 밖/);
  assert.equal(needsReview({ classified_by: 'ai', type: 0, rule_type: out.type }), false); // 규칙이 판단 못 한 건 확인 필요 아님
  assert.equal(needsReview({ classified_by: 'ai', type: null, rule_type: 2 }), true); // AI가 기준 밖이라 했는데 규칙은 해당
});

test('기준 정리: AI 초안 가중치는 합 100으로 맞추고, 교수 확정은 엄격 검증', () => {
  const n = normalizeCriteria([{ name: 'A', weight: 1 }, { name: 'B', weight: 1 }, { name: 'C', weight: 1 }, { name: 'D', kinds: ['없는종류', 'Issue'] }]);
  assert.equal(n.reduce((a, c) => a + c.weight, 0), 100);
  assert.deepEqual(n[3].kinds, ['Issue']);
  assert.throws(() => normalizeCriteria([{ name: 'A', weight: 70 }], { strict: true }), /100/);
  assert.deepEqual(ruleCriteria('1. 코드 구현: 50%\n- 문서 작성 (30점)\n발표 태도').map(c => [c.name, c.weight]), [['코드 구현', 50], ['문서 작성', 30]]);
});

test('기록으로 확인할 수 없는 기준은 AI가 넣어도 서버가 제외', () => {
  const { criteria, excluded } = splitUnobservable([{ name: '기능 구현', weight: 60 }, { name: '최종 발표 및 시연', weight: 20 }, { name: '품질 관리', weight: 20 }]);
  assert.deepEqual(criteria.map(c => c.name), ['기능 구현', '품질 관리']);
  assert.match(excluded[0].text, /발표/);
});

test('기준 도입 전(고정 3축) 팀도 옛 규칙으로 계속 분류', () => {
  const c = criteriaOf({ categories: JSON.stringify(['만들기', '다듬기', '이끌기']), weights: JSON.stringify([40, 35, 25]) });
  assert.equal(ruleClassify({ kind: 'Commit', title: 'fix: 오류' }, c).type, 1);
  assert.equal(ruleClassify({ kind: 'Issue', title: '로그인' }, c).type, 2);
});
