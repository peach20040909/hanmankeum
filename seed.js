import { randomUUID } from 'node:crypto';

// 본선 시연용 예시 팀 (UI·UX 초안의 예시 데이터)
const MEMBERS = [
  ['박준호', '팀장 · 개발', 'junho-park'],
  ['김서연', '기획 · 자료 제작', 'seoyeon-kim'],
  ['이다은', '개발 · 테스트', 'daeun-lee'],
  ['최민재', '시연 · 현장 준비', 'minjae-choi'],
];

// [팀원 index, 도구, 종류, 제목, 유형, 날짜, ref, 사유, 본문]
const RECORDS = [
  [0, 'GitHub', 'Pull request', '분실물 매칭 API와 검색 필터 구현', 1, '2026-12-12T16:42', 'PR #34', '검색 API와 매칭 로직 변경 사항을 제작 유형으로 분류했습니다.', '+ async function findMatches(item) {\n+   const candidates = await repository.search(item.category);\n+   return rankByLocationAndDate(candidates, item);\n+ }'],
  [0, 'GitHub', 'Commit', '매칭 점수 계산 로직 추가', 1, '2026-12-11T21:10', 'Commit 9b2e1f0', '매칭 기능 구현 커밋을 제작 유형으로 분류했습니다.', '+ const score = sameCategory * 0.5 + nearPlace * 0.3 + nearTime * 0.2;'],
  [0, 'GitHub', 'Commit', '분실물 등록 API 구현', 1, '2026-11-30T19:02', 'Commit 41ac2d9', '등록 API 구현 커밋을 제작 유형으로 분류했습니다.', '+ router.post("/items", validateItem, createItem);'],
  [0, 'GitHub', '코드 리뷰', '분실물 등록 예외 처리 코드 리뷰', 2, '2026-12-09T20:06', 'Review #19 · PR #31', '예외 상황을 검토하고 수정 여부를 확인한 리뷰를 QA 유형에 연결했습니다.', '필수 항목이 비어 있을 때 등록이 차단되는지 확인\n이미지 업로드 실패 시 다시 시도할 수 있는지 확인'],
  [0, 'Docs', '문서 편집', '기술 명세서의 매칭 기준 보완', 0, '2026-12-06T11:48', '기술 명세서 · 수정 12', '매칭 기능의 기준과 예외를 정의한 기술 명세 편집을 기획 유형에 연결했습니다.', '2. 매칭 기준\n분실물의 카테고리가 일치하는 후보를 조회합니다.\n발견 장소와 등록 시점을 함께 비교합니다.'],
  [1, 'Notion', '문서 편집', '사용자 인터뷰를 바탕으로 요구사항 정리', 0, '2026-12-10T13:18', '요구사항 정의서 · 변경 기록 #78', '사용자 문제와 서비스 요구사항을 정의한 편집 기록으로 기획 유형에 연결했습니다.', '사용자 요구사항 v3\n분실물 등록 시 위치와 발견 시간을 함께 입력한다.\n카테고리와 보관 장소로 검색 결과를 좁힐 수 있어야 한다.'],
  [1, 'Notion', '문서 편집', '경쟁 서비스 조사 및 차별점 정리', 0, '2026-10-02T15:30', '리서치 · 변경 기록 #21', '시장·경쟁 조사 문서를 기획 유형에 연결했습니다.', '에브리타임 분실물 게시판 · 학교 행정실 보관함 비교'],
  [1, 'Slides', '슬라이드 편집', '최종 발표 자료의 서비스 흐름 및 성과 정리', 3, '2026-12-08T18:32', '최종 발표 자료 · 버전 12', '발표용 서비스 흐름과 결과를 구성한 수정 기록으로 발표자료 유형에 연결했습니다.', '03. 서비스 이용 흐름\n발견 → 등록 → 매칭 → 본인 확인 → 물품 수령'],
  [1, 'Notion', '일정 편집', '최종 시연 일정과 담당 작업 업데이트', 4, '2026-12-05T10:10', '팀 작업 보드 · 변경 기록 #90', '공유 일정과 담당 작업을 조정한 작업 보드 기록으로 조율 유형에 연결했습니다.', '12/08 · 발표 자료 최종 검토 · 김서연\n12/10 · 오류 수정 및 테스트 · 박준호, 이다은\n12/12 · 현장 세팅 확인 · 최민재'],
  [1, 'GitHub', '코드 리뷰', '목록 화면 UX 문구 리뷰', 2, '2026-12-04T22:40', 'Review #15 · PR #28', '사용자 문구와 흐름을 검토한 리뷰를 QA 유형에 연결했습니다.', '빈 목록 안내 문구가 다음 행동을 알려주는지 확인'],
  [2, 'GitHub', 'Commit', '분실물 등록·조회 테스트 케이스 추가', 2, '2026-12-07T15:21', 'Commit a3f21d8', '기능별 정상·실패 상황을 검증하는 테스트 변경을 QA 유형에 연결했습니다.', '+ test("필수 입력이 없으면 안내를 표시한다", () => {\n+   expect(validateItem({})).toEqual("내용을 입력해 주세요");\n+ });'],
  [2, 'GitHub', 'Commit', '분실물 목록과 상세 화면 연결', 1, '2026-12-04T17:45', 'Commit c82e4a1', '목록에서 물품 상세 정보를 확인하는 화면 구현을 제작 유형에 연결했습니다.', '+ function openItem(id) {\n+   navigate(`/items/${id}`);\n+ }'],
  [2, 'Slides', '슬라이드 편집', '시연 시나리오와 테스트 결과 시각화', 3, '2026-12-03T14:02', '최종 발표 자료 · 버전 9', '시연 순서와 테스트 결과를 정리한 편집을 발표자료 유형에 연결했습니다.', '시연 시나리오\n① 분실물 등록 ② 조건별 검색 ③ 상세 정보 확인'],
];

export function seedDemo(db) {
  const id = randomUUID();
  db.prepare(`INSERT INTO teams (id, course, name, project, start_date, deadline, repo, tools, categories, weights, locked_at, closed_at, collected_at)
    VALUES (?, '캡스톤디자인(2)', '팀 3', '캠퍼스 분실물 매칭 앱', '2026-09-08', '2026-12-15', NULL, ?, ?, ?, '2026-09-08 10:00:00', '2026-12-15 23:59:59', '2026-12-15 23:59:59')`)
    .run(id, JSON.stringify(['GitHub', 'Notion', 'Docs', 'Slides']), JSON.stringify(['기획', '제작', 'QA', '발표자료', '조율']), JSON.stringify([20, 40, 15, 15, 10]));
  const ids = MEMBERS.map(([name, role, github]) =>
    db.prepare("INSERT INTO members (team_id, name, role, github, confirmed_at) VALUES (?,?,?,?, '2026-09-08 09:30:00')").run(id, name, role, github).lastInsertRowid);
  const ins = db.prepare("INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'demo')");
  RECORDS.forEach(([m, tool, kind, title, type, date, ref, reason, body], i) => ins.run(id, ids[m], `demo:${i}`, tool, kind, title, body, ref, date, type, reason));
  db.prepare("INSERT INTO statements (team_id, member_id, text, created_at) VALUES (?,?,?, '2026-12-16 11:00:00')")
    .run(id, ids[3], '기말 시연용 하드웨어(라즈베리파이 키오스크) 조립과 현장 세팅을 맡았고, 11/28과 12/5 오프라인 리허설을 진행했습니다. 코드 작업은 팀원 노트북에서 함께해서 제 계정 커밋으로 남지 않았습니다.');
  return id;
}
