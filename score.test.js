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

test('규칙 분류: 4축 (0 생성 · 1 개선 · 2 조율/관리 · 3 의사소통)', async () => {
  const { ruleClassify } = await import('./collect.js');
  const c = (kind, title, tool = 'GitHub') => ruleClassify({ kind, title, tool }).type;
  assert.equal(c('Commit', '검색 화면 구현'), 0);
  assert.equal(c('Commit', 'fix: 로그인 오류'), 1);
  assert.equal(c('Commit', '오타 수정'), 1);
  assert.equal(c('Commit', 'chore: CI 설정'), 2);
  assert.equal(c('코드 리뷰', '리뷰: 화면'), 1);
  assert.equal(c('Issue', '로그인 기능'), 2);
  assert.equal(c('댓글', '좋아요'), 3);
  assert.equal(c('문서 작성', '회의 일정 정리', 'Docs'), 2);
  assert.equal(c('문서 작성', '발표 피드백 정리', 'Docs'), 3);
  assert.equal(c('Commit', 'prefix 추가'), 0); // 'fix'는 단어 단위로만
});

test('Notion 서명 검증 · 페이지 링크 파싱', async () => {
  const { verifySignature, parsePageId } = await import('./notion.js');
  const { createHmac } = await import('node:crypto');
  const body = Buffer.from('{"type":"page.created"}');
  const sig = `sha256=${createHmac('sha256', 'secret_x').update(body).digest('hex')}`;
  assert.equal(verifySignature(body, sig, 'secret_x'), true);
  assert.equal(verifySignature(body, sig, 'secret_y'), false);
  assert.equal(verifySignature(body, 'sha256=short', 'secret_x'), false);
  assert.equal(verifySignature(body, undefined, 'secret_x'), false);
  const id = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
  assert.equal(parsePageId(`https://www.notion.so/team/Cafe-${id}?pvs=4`), '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d');
  assert.equal(parsePageId('1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'), '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d');
  assert.equal(parsePageId('https://example.com/nope'), null);
});
