import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSentences, compareDraft, draftText, overlap } from './generate.js';

const records = [
  { id: 11, title: '분실물 매칭 API와 검색 필터 구현', body: '', ref: 'PR #34', tool: 'GitHub', kind: 'Pull request' },
  { id: 12, title: '12월 2주차 회의록과 담당 정리', body: '', ref: 'Notion · 2026-12-05', tool: 'Notion', kind: '페이지 생성' },
];

test('근거 검증: 없는 번호·근거 없음·평가 표현은 제외, 통과 문장은 실제 기록 id로', () => {
  const { kept, dropped } = validateSentences([
    { text: '분실물 매칭 API와 검색 필터를 구현했다.', refs: [1] },
    { text: '회의록과 담당을 정리했다.', refs: [2, 9] },     // 9번은 없는 기록
    { text: '발표 리허설을 진행했다.', refs: [7] },          // 없는 기록만 인용 → 지어낸 문장
    { text: '팀에서 가장 성실하게 참여했다.', refs: [1] },   // 평가 표현
    { text: '테스트를 작성했다.', refs: [] },               // 근거 없음
  ], records);
  assert.deepEqual(kept.map(s => s.refs), [[11], [12]]);
  assert.match(kept[1].note, /9/);
  assert.deepEqual(dropped.map(d => d.reason), ['존재하지 않는 기록 번호 인용 (7)', '기록으로 확인할 수 없는 능력·태도 평가 표현', '근거 기록 번호가 없음']);
});

test('근거와 내용이 동떨어지면 약한 연결로 표시', () => {
  assert.ok(overlap('분실물 매칭 API를 구현했다', [records[0]]) > 0.3);
  const { kept } = validateSentences([{ text: '디자인 시안을 그렸다.', refs: [1] }], records);
  assert.equal(kept[0].weak, true);
});

test('초안 대비 수정률', () => {
  const draft = draftText([{ text: '저는 매칭 API를 구현했습니다.', refs: [11] }, { text: '저는 회의록을 정리했습니다.', refs: [12] }], records);
  assert.match(draft, /\(근거: PR #34\)/);
  assert.equal(compareDraft(draft, draft).changed, 0);
  const d = compareDraft(draft, '저는 매칭 API와 검색 필터를 구현했습니다.\n시연 장비도 직접 점검했습니다.');
  assert.equal(d.kept, 0);
  assert.equal(d.edited, 1);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.ok(d.changed > 20);
});
