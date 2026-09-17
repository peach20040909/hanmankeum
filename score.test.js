import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScores } from './score.js';

test('가중치 × 유형 내 비중 합산', () => {
  const members = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const weights = [40, 60];
  const records = [
    { member_id: 1, type: 0 }, { member_id: 1, type: 0 }, { member_id: 2, type: 0 }, { member_id: 2, type: 0 },
    { member_id: 2, type: 1 },
    { member_id: 99, type: 1 }, // 매칭 안 된 기록은 무시
  ];
  const [a, b, c] = computeScores(members, records, weights);
  assert.equal(a.score, 20);
  assert.equal(b.score, 80);
  assert.equal(c.score, 0);
  assert.equal(a.score + b.score + c.score, 100);
});

test('기록 없는 유형의 가중치는 재배분, 기록이 아예 없으면 0', () => {
  const [a, b] = computeScores([{ id: 1 }, { id: 2 }], [{ member_id: 1, type: 1 }], [20, 40, 40]);
  assert.equal(a.score, 100);
  assert.equal(b.score, 0);
  assert.equal(computeScores([{ id: 1 }], [], [100])[0].score, 0);
});

test('규칙 분류: 키워드 → 팀 유형', async () => {
  const { ruleClassify } = await import('./collect.js');
  const cats = ['기획', '제작', 'QA', '발표자료', '조율'], ws = [20, 40, 15, 15, 10];
  assert.equal(ruleClassify({ kind: 'Commit', title: 'add login tests' }, cats, ws).type, 2);
  assert.equal(ruleClassify({ kind: 'Commit', title: 'README 업데이트' }, cats, ws).type, 0);
  assert.equal(ruleClassify({ kind: '코드 리뷰', title: '리뷰: 화면' }, cats, ws).type, 2);
  assert.equal(ruleClassify({ kind: 'Commit', title: '검색 화면 구현' }, cats, ws).type, 1);
});
