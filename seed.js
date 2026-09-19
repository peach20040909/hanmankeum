import { randomUUID } from 'node:crypto';

// 본선 시연용 예시 팀 (4축: 0 생성 · 1 개선 · 2 조율/관리 · 3 의사소통)
const MEMBERS = [
  ['박준호', '팀장 · 개발', 'junho-park', 'junho@mju.ac.kr'],
  ['김서연', '기획 · 자료 제작', 'seoyeon-kim', 'seoyeon@mju.ac.kr'],
  ['이다은', '개발 · 테스트', 'daeun-lee', 'daeun@mju.ac.kr'],
  ['최민재', '시연 · 현장 준비', 'minjae-choi', 'minjae@mju.ac.kr'],
];

// [팀원 index, 도구, 종류, 제목, 축, 날짜, ref, 사유, 본문]
const RECORDS = [
  [0, 'GitHub', 'Pull request', '분실물 매칭 API와 검색 필터 구현', 0, '2026-12-12T16:42', 'PR #34', '새 기능을 구현한 PR이라 산출물 생성에 연결했습니다.', '+ async function findMatches(item) {\n+   const candidates = await repository.search(item.category);\n+   return rankByLocationAndDate(candidates, item);\n+ }'],
  [0, 'GitHub', 'Commit', '매칭 점수 계산 로직 추가', 0, '2026-12-11T21:10', 'Commit 9b2e1f0', '새 로직을 추가한 커밋이라 산출물 생성에 연결했습니다.', '+ const score = sameCategory * 0.5 + nearPlace * 0.3 + nearTime * 0.2;'],
  [0, 'GitHub', 'Commit', '분실물 등록 API 구현', 0, '2026-11-30T19:02', 'Commit 41ac2d9', '새 API를 만든 커밋이라 산출물 생성에 연결했습니다.', '+ router.post("/items", validateItem, createItem);'],
  [0, 'GitHub', '코드 리뷰', '분실물 등록 예외 처리 코드 리뷰', 1, '2026-12-09T20:06', 'Review #19 · PR #31', '다른 팀원의 PR을 검토한 리뷰라 산출물 개선에 연결했습니다.', '필수 항목이 비어 있을 때 등록이 차단되는지 확인\n이미지 업로드 실패 시 다시 시도할 수 있는지 확인'],
  [0, 'GitHub', 'Issue', '12/10까지 오류 수정 담당 배분', 2, '2026-12-06T09:30', 'Issue #40', '할 일과 담당자를 정한 이슈라 조율/관리에 연결했습니다.', '- 검색 필터 버그: 박준호\n- 테스트 보강: 이다은'],
  [0, 'GitHub', '댓글', '매칭 기준은 거리보다 시간 우선으로 가죠', 3, '2026-12-05T22:15', 'Issue/PR 댓글', '논의에 참여한 댓글이라 의사소통에 연결했습니다.', ''],
  [1, 'Notion', '문서 편집', '사용자 인터뷰를 바탕으로 요구사항 정리', 0, '2026-12-10T13:18', 'Notion · 2026-12-10', '본인이 만든 페이지의 내용을 작성해 산출물 생성에 연결했습니다.', '사용자 요구사항 v3\n분실물 등록 시 위치와 발견 시간을 함께 입력한다.'],
  [1, 'Notion', '페이지 생성', '경쟁 서비스 조사 및 차별점 정리', 0, '2026-10-02T15:30', 'Notion · 2026-10-02', '새 페이지를 만들어 산출물 생성에 연결했습니다.', ''],
  [1, 'Slides', '문서 편집', '최종 발표 자료의 서비스 흐름 보완', 1, '2026-12-08T18:32', 'Slides 링크', "'보완' 키워드로 산출물 개선에 연결했습니다.", '03. 서비스 이용 흐름\n발견 → 등록 → 매칭 → 본인 확인 → 물품 수령'],
  [1, 'Notion', '속성 편집', '최종 시연 일정과 담당 작업 업데이트', 2, '2026-12-05T10:10', 'Notion · 2026-12-05', '일정·담당·상태 등 속성 변경을 조율/관리에 연결했습니다.', '12/08 · 발표 자료 최종 검토 · 김서연\n12/12 · 현장 세팅 확인 · 최민재'],
  [1, 'Notion', '속성 편집', '주간 회의 안건 등록', 2, '2026-11-20T09:00', 'Notion · 2026-11-20', '일정·담당·상태 등 속성 변경을 조율/관리에 연결했습니다.', ''],
  [1, 'Notion', '댓글', '인터뷰 질문 순서에 대한 피드백', 3, '2026-10-15T20:40', 'Notion · 2026-10-15', '페이지 댓글을 의사소통에 연결했습니다.', ''],
  [1, 'GitHub', '댓글', '빈 목록 안내 문구 제안', 3, '2026-12-04T22:40', 'Issue/PR 댓글', '논의에 참여한 댓글이라 의사소통에 연결했습니다.', ''],
  [2, 'GitHub', 'Commit', '분실물 등록·조회 테스트 케이스 추가', 0, '2026-12-07T15:21', 'Commit a3f21d8', '새 테스트를 추가한 커밋이라 산출물 생성에 연결했습니다.', '+ test("필수 입력이 없으면 안내를 표시한다", () => {\n+   expect(validateItem({})).toEqual("내용을 입력해 주세요");\n+ });'],
  [2, 'GitHub', 'Commit', 'fix: 상세 화면 이동 오류 수정', 1, '2026-12-04T17:45', 'Commit c82e4a1', "'fix' 키워드로 산출물 개선에 연결했습니다.", '- navigate(`/item/${id}`)\n+ navigate(`/items/${id}`)'],
  [2, 'Notion', '문서 편집', '기술 명세서의 매칭 기준 오탈자 보완', 1, '2026-12-03T14:02', 'Notion · 2026-12-03', '다른 팀원이 만든 페이지를 편집해 산출물 개선에 연결했습니다.', ''],
  [2, 'GitHub', '댓글', '테스트 실패 원인 공유', 3, '2026-12-07T16:00', 'Issue/PR 댓글', '논의에 참여한 댓글이라 의사소통에 연결했습니다.', ''],
];

const OPINIONS = [
  [2, '저희 팀은 테스트 비중이 커서 산출물 개선 가중치를 30보다 조금 더 높였으면 합니다.', 'accepted', '개발 프리셋(개선 30)을 적용했습니다.'],
  [3, '시연 준비는 온라인 기록이 없어서, 의사소통 비중을 더 높여 주셨으면 합니다.', 'rejected', '오프라인 기여는 자기 기술·동료평가로 확인합니다. 가중치는 온라인 활동 기준으로 유지합니다.'],
];

// [작성자, 대상, 기간, 축, 한 일, 도움, 근거, 링크, 연결 기록 index, 교수 전달]
const REVIEWS = [
  [0, 3, '13주차 (11.30~)', 2, '라즈베리파이 키오스크를 조립하고 시연장 네트워크를 미리 확인했습니다.', '시연 당일 장비 문제 없이 진행됐습니다.', '함께 수행', null, null, null],
  [1, 3, '14주차 (12.07~)', 2, '11/28, 12/5 오프라인 리허설 일정을 잡고 진행했습니다.', '발표 순서와 시간 배분이 정리됐습니다.', '직접 관찰', null, null, null],
  [2, 3, '전체 기간', 0, '제 노트북에서 매칭 화면 코드를 함께 작성했습니다. 커밋은 제 계정으로 남았습니다.', '상세 화면을 기한 안에 완성했습니다.', '함께 수행', null, 14, '공동 작업이 제 커밋(상세 화면 이동 오류 수정)에 포함돼 있습니다.'],
  [3, 0, '전체 기간', 0, '매칭 API를 대부분 구현했습니다.', '핵심 기능이 동작하게 됐습니다.', '산출물 확인', null, 0, null],
  [3, 1, '전체 기간', 2, '회의 일정과 담당을 꾸준히 정리했습니다.', '마감 전 일정이 밀리지 않았습니다.', '직접 관찰', null, null, null],
  [3, 2, '전체 기간', 1, '테스트를 추가하고 오류를 여러 번 고쳤습니다.', '시연 중 오류가 없었습니다.', '산출물 확인', null, null, null],
];

export function seedDemo(db, newKey) {
  const id = randomUUID();
  db.prepare(`INSERT INTO teams (id, course, name, project, start_date, deadline, repo, tools, categories, weights, locked_at, closed_at, collected_at, prof_key)
    VALUES (?, '캡스톤디자인(2)', '팀 3', '캠퍼스 분실물 매칭 앱', '2026-09-07', '2026-12-15', NULL, ?, ?, ?, '2026-09-11 10:00:00', '2026-12-15 23:59:59', '2026-12-15 23:59:59', ?)`)
    .run(id, JSON.stringify(['GitHub', 'Notion', '수동 기록']), JSON.stringify(['산출물 생성', '산출물 개선', '조율/관리', '의사소통']), JSON.stringify([40, 30, 15, 15]), newKey());
  const ids = MEMBERS.map(([name, role, github, email]) =>
    db.prepare("INSERT INTO members (team_id, name, role, github, notion_email, key, consented_at, confirmed_at) VALUES (?,?,?,?,?,?, '2026-09-08 09:00:00', '2026-09-10 09:30:00')")
      .run(id, name, role, github, email, newKey()).lastInsertRowid);
  const ins = db.prepare("INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'demo')");
  const recIds = RECORDS.map(([m, tool, kind, title, type, date, ref, reason, body], i) => ins.run(id, ids[m], `demo:${i}`, tool, kind, title, body, ref, date, type, reason).lastInsertRowid);
  for (const [m, text, status, reply] of OPINIONS) db.prepare('INSERT INTO opinions (team_id, member_id, text, status, reply) VALUES (?,?,?,?,?)').run(id, ids[m], text, status, reply);
  db.prepare("INSERT INTO statements (team_id, member_id, text, created_at) VALUES (?,?,?, '2026-12-16 11:00:00')")
    .run(id, ids[3], '기말 시연용 하드웨어(라즈베리파이 키오스크) 조립과 현장 세팅을 맡았고, 11/28과 12/5 오프라인 리허설을 진행했습니다. 코드 작업은 팀원 노트북에서 함께해서 제 계정 커밋으로 남지 않았습니다.');
  const rv = db.prepare('INSERT INTO peer_reviews (team_id, reviewer_id, target_id, period, axis, did, impact, basis, link, record_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const [from, to, period, axis, did, impact, basis, link, rec, note] of REVIEWS) rv.run(id, ids[from], ids[to], period, axis, did, impact, basis, link, rec == null ? null : recIds[rec], note);
  return id;
}
