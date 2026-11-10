import { randomUUID } from 'node:crypto';
import { run } from './db.js';
import { ruleClassify, detectAI, PROMPT_VERSION } from './collect.js';

// 본선 시연용 예시 팀. 교수가 원래 쓰던 캡스톤디자인 평가기준을 입력하고,
// AI가 정리한 기준 항목을 교수가 확인·수정해 확정한 상태로 시작한다.
//
// 작업 기록은 지어낸 것이 아니라 **이 서비스를 만든 저장소(peach20040909/hanmankeum)의
// 실제 커밋·PR**이다. 제목·날짜·본문·원본 링크가 전부 진짜라서, 화면에서 '원본 열기'를
// 누르면 GitHub 로 간다. "근거로 확인한다"는 주장을 시연 데이터부터 지키기 위해서다.
// 다만 팀원 배정·기여율·동료 증언·자기 기술은 화면 설명을 위해 구성한 예시다
// (실제 커밋은 대부분 한 계정에서 나왔다). 그 사실은 화면 상단 배너에 밝힌다.
const MEMBERS = [
  ['박준호', '팀장 · 개발', 'peach20040909', 'junho@mju.ac.kr'],
  ['김서연', '기획 · 자료 제작', 'seoyeon-kim', 'seoyeon@mju.ac.kr'],
  ['이다은', '개발 · 테스트', 'daeun-lee', 'daeun@mju.ac.kr'],
  ['최민재', '시연 · 현장 준비', 'minjae-choi', 'minjae@mju.ac.kr'],
];

const GH = 'https://github.com/peach20040909/hanmankeum';
const CO = '\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>';

// [팀원 index, 도구, 종류, 제목, 기준 항목, 날짜, ref, 사유, 본문, 원본 URL]
// 기준 항목(type)은 AI 분류 결과. 규칙 판단은 아래 seedDemo 에서 ruleClassify 로 따로 계산해
// 함께 저장하므로, 둘이 다른 기록은 화면에서 '확인 필요'로 뜬다 (의도적으로 2건).
const RECORDS = [
  // ── 박준호 (팀장 · 개발)
  [0, 'GitHub', 'Pull request', 'AI 리터러시: 분류 교차 확인, AI 사용 표시, 프롬프트 버전', 0, '2026-10-16T16:52', 'PR #1',
    "새 기능을 구현해 올린 PR이라 '기능 구현'에 연결했습니다.",
    "AI 리터러시 경진대회 제안서의 '검증 설계'를 서비스에 반영합니다.\n\n- AI 분류와 규칙 판단이 다르면 '확인 필요' 표시, 교수가 원본을 보고 확정\n- 분류 프롬프트 버전(PROMPT_VERSION)을 기록마다 저장\n- 커밋 AI 공동 작성자·생성 문구·[AI] 표시로 'AI 도움' 기록 구분 (기여율 영향 없음)\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    `${GH}/pull/1`],
  [0, 'GitHub', 'Pull request', '근거 인용 기여 요약 · 자기 기술 초안 (생성형 AI + 근거 검증)', 0, '2026-10-30T05:44', 'PR #2',
    "요약·초안 기능을 구현한 PR이라 '기능 구현'에 연결했습니다.",
    '학생 시점의 생성형 AI 기능 2가지.\n\n- 근거 인용 기여 요약: 문장마다 근거 기록, 서버 검증으로 지어낸 문장·평가 표현 제외(이유 공개), 학생 이의 표시\n- 자기 기술 초안: 본인 기록 기반 1인칭 초안, 대조 확인 체크 필수, 교수에게 초안 대비 수정률 표시',
    `${GH}/pull/2`],
  [0, 'GitHub', 'Commit', 'Notion 연결 점검 엔드포인트 추가', 0, '2026-10-31T16:01', 'Commit 3acd505',
    "새 점검 엔드포인트를 추가한 구현이라 '기능 구현'에 연결했습니다.",
    `웹훅은 동작하는데 제목·작성자가 비는 문제를 진단하기 위해,\n토큰으로 팀 페이지와 사용자 정보를 읽을 수 있는지 교수가 확인할 수 있게 했다.${CO}`,
    `${GH}/commit/3acd50554e5a93da9a2a8d959834f45e898353db`],
  [0, 'GitHub', 'Commit', '리포트 재배치: AI가 한 일을 맨 위로, 본문 7카드 → 3카드', 0, '2026-10-30T15:08', 'Commit 8cc5764',
    "리포트 화면 블록을 새로 구현한 커밋이라 '기능 구현'에 연결했습니다.",
    `- 'AI가 한 일' 블록 신설: 분류 건수 + 교수가 확인해야 할 건수 + 바로가기\n- 팀 요약·적용 가중치 카드를 기여율 카드 안으로 병합\n- 중복되던 면책 문구 4개 → 하단 1개${CO}`,
    `${GH}/commit/8cc5764fa9493a27a8855bc13e860e1b74857bf3`],
  [0, 'GitHub', 'Commit', 'GitHub 저장소를 연결할 방법이 UI에 없던 문제', 0, '2026-11-01T14:31', 'Commit 4f4f644',
    "저장소 연결 API와 입력란을 새로 만든 커밋이라 '기능 구현'에 연결했습니다.",
    `착수 설정에 Notion 입력만 있고 GitHub 저장소 입력이 없어, 팀을 만든 뒤에는\n저장소를 연결할 방법이 아예 없었다.\n\n- PUT /api/teams/:id/repo 추가 (교수 전용, 마감 후 거부, owner/name 검증)\n- 착수 설정 2단계에 저장소 입력란과 안내 추가${CO}`,
    `${GH}/commit/4f4f644820a4f8bfd2f293466b8a750c875e6d55`],
  [0, 'GitHub', 'Commit', 'chore: Other 프리셋으로 재배포', 3, '2026-10-30T06:10', 'Commit 1aa9b9b',
    "재배포를 위한 설정 커밋이라 '프로젝트 관리'에 연결했습니다.", `chore: Other 프리셋으로 재배포${CO}`,
    `${GH}/commit/1aa9b9b8933e4de24ffcc27b50fc78b05d815b54`],

  // ── 김서연 (기획 · 자료 제작)
  [1, 'GitHub', 'Commit', '프롬프트 문서 추가 · 검수에서 나온 2건 수정', 2, '2026-11-01T15:00', 'Commit 80714e6',
    "프롬프트 문서를 새로 쓴 커밋이라 '문서화'에 연결했습니다.",
    `docs/prompts.md — 분류·요약·초안 프롬프트 전문과 설계 의도, 버전 관리,\n서버 검증 설계, 검수 기록, AI 사용 출처 표기.\n\n검수에서 고친 것:\n- selfdraft 프롬프트의 해석 불가능한 지시를 다시 썼다 → selfdraft-v2\n- 프롬프트가 금지한 '주도적'이 서버 정규식에 없어 추가${CO}`,
    `${GH}/commit/80714e6a1b2fbd6e298f884c8aabf9980d44103d`],
  [1, 'GitHub', 'Commit', '저장소를 검증 가능하게: LICENSE · 빠른 확인 절차 · 테스트 설명 · 구조 문서', 2, '2026-11-01T10:37', 'Commit 3e82c78',
    "LICENSE·README·구조 문서를 작성한 커밋이라 '문서화'에 연결했습니다.",
    `처음 보는 사람이 직접 돌려보고 확인할 수 있어야 '근거로 확인한다'는 주장이 성립한다.\n\n- LICENSE (MIT) 추가\n- README: 5분 안에 직접 확인하기 (클론→테스트→실행)\n- docs/architecture.md: 전체 흐름도, 수집/저장/AI 전달 범위 구분, 권한 모델${CO}`,
    `${GH}/commit/3e82c787191a36304fb5d6b4f74787690166095f`],
  [1, 'GitHub', 'Commit', 'docs: AI 리터러시 디벨롭 설계 초안 (승인 전)', 2, '2026-10-30T14:21', 'Commit b23ad6c',
    "설계 문서 초안을 쓴 커밋이라 '문서화'에 연결했습니다.", `docs: AI 리터러시 디벨롭 설계 초안 (승인 전)${CO}`,
    `${GH}/commit/b23ad6c4120c5282f63ca0810b8865135941a707`],
  [1, 'GitHub', 'Commit', 'README: 학교 LMS 연동을 향후 계획으로 명시', 2, '2026-11-01T14:55', 'Commit e5a5ce2',
    "README에 계획을 적은 문서 수정이라 '문서화'에 연결했습니다.",
    `기관 승인이 필요해 이번 범위에서 뺀 것이라, 안 한 게 아니라 못 한 것임을\n단계와 함께 적어 둔다. 코드는 건드리지 않는다.${CO}`,
    `${GH}/commit/e5a5ce27fa196e2295a794a665223e1e4f3b5d6f`],

  // ── 이다은 (개발 · 테스트)
  [2, 'GitHub', 'Commit', '보안 검토 지적 6건 조치 + 검증 기록 문서화', 1, '2026-11-01T10:44', 'Commit bc78555',
    "보안 검토 지적을 고친 커밋이라 '품질 관리'에 연결했습니다.",
    `독립 검토자(코드를 쓰지 않은 별도 AI)에게 전체 코드베이스를 넘겨 받은 지적을\n하나씩 재현·확인하고 조치했다.\n\n- [HIGH] Notion 이메일 검증이 '%@%'를 통과시켜, LIKE 패턴으로 팀의 미매칭 기록\n  전부를 본인에게 붙일 수 있었다. 기여율이 직접 조작된다.\n  → 와일드카드 거부 + 정확 일치, 재발 방지 테스트 추가${CO}`,
    `${GH}/commit/bc7855544013018f16d90712264f29609c395af7`],
  [2, 'GitHub', 'Commit', 'PDF가 한 쪽에서 끊기고 아래가 비던 문제 수정', 1, '2026-10-31T16:32', 'Commit f844f85',
    "PDF 출력 오류를 고친 커밋이라 '품질 관리'에 연결했습니다.",
    `.card{break-inside:avoid}가 모든 카드에 걸려 있어, 긴 카드가 남은 공간에\n못 들어가면 통째로 다음 쪽으로 밀리며 큰 여백이 생겼다.\n쪼개지면 안 되는 작은 단위만 묶도록 바꿨다.${CO}`,
    `${GH}/commit/f844f85ee84faa6992f19937a2d0971e2944ac9e`],
  [2, 'GitHub', 'Commit', 'chore: Vercel 미리보기 배포 트리거', 3, '2026-10-30T06:07', 'Commit 0b10754',
    "배포 설정 커밋이라 '프로젝트 관리'에 연결했습니다.", `chore: Vercel 미리보기 배포 트리거${CO}`,
    `${GH}/commit/0b10754326713f7593be90c4fd648cf467146759`],
  // ↓ 83b4bc3은 AI 분류와 규칙 판단('fix' 키워드)이 엇갈린다 → '확인 필요' (80714e6도 같음)
  [2, 'GitHub', 'Commit', 'fix: app.js → handler.js (Vercel이 Node 서버 진입점으로 오인)', 3, '2026-10-30T06:09', 'Commit 83b4bc3',
    "배포 진입점을 바로잡은 설정 변경이라 '프로젝트 관리'에 연결했습니다.",
    `fix: app.js → handler.js (Vercel이 Node 서버 진입점으로 오인)${CO}`,
    `${GH}/commit/83b4bc38a37667ded8a2a88135ef84d06580fbc2`],
  [2, 'GitHub', 'Pull request', 'Render → Vercel 이전 (libSQL/Turso + 서버리스 함수)', 0, '2026-10-30T05:53', 'PR #3',
    "DB와 서버 구조를 새로 구현해 옮긴 PR이라 '기능 구현'에 연결했습니다.",
    'Vercel 함수는 요청마다 잠깐 실행돼서 파일 DB가 유지되지 않습니다.\nDB를 Turso(libSQL)로 바꾸고, 라우팅을 로컬·서버리스 공통 모듈로 분리했습니다.',
    `${GH}/pull/3`],
];

export const DEMO_RUBRIC = `캡스톤디자인(2) 팀 프로젝트 평가 기준 (기여도 반영)
- 기능 구현 40%: 요구사항을 실제로 동작하는 기능으로 구현
- 품질 관리 20%: 테스트, 코드 리뷰, 버그·보안 수정
- 문서화 15%: 설계 문서, README, 사용 설명
- 프로젝트 관리 25%: 일정·이슈 관리, 배포 환경 설정
- 최종 발표 및 시연은 팀 점수로 별도 평가`;

// AI가 위 기준을 정리한 초안을 교수가 확인하고 확정한 결과 (품질 관리는 학생 의견을 받아 20→25%)
export const DEMO_CRITERIA = [
  { name: '기능 구현', desc: '요구사항을 실제로 동작하는 기능으로 구현한 작업', weight: 40, keywords: ['구현', '기능', '엔드포인트', 'feat', 'add'], kinds: ['Pull request'] },
  { name: '품질 관리', desc: '테스트·코드 리뷰·버그와 보안 수정으로 결과물을 고친 작업', weight: 25, keywords: ['수정', 'fix', '테스트', 'test', '리뷰', '보안', '검토'], kinds: ['코드 리뷰', '리뷰 댓글'] },
  { name: '문서화', desc: '설계 문서·README·사용 설명을 쓴 작업', weight: 15, keywords: ['문서', 'docs', 'README', '설계', 'LICENSE'], kinds: ['페이지 생성'] },
  { name: '프로젝트 관리', desc: '일정·이슈 관리와 배포 환경 설정처럼 진행을 관리한 작업', weight: 20, keywords: ['chore', '배포', '계획', '일정', '회의', '설정'], kinds: ['Issue', '속성 편집'] },
];
const DEMO_META = {
  by: 'ai', prompt_version: 'criteria-draft-v1', edited: true,
  excluded: [{ text: '최종 발표 및 시연', why: '발표·시연의 완성도는 작업 기록으로 확인할 수 없어 교수가 직접 평가합니다.' }],
};

const OPINIONS = [
  [2, '저희 팀은 리뷰와 오류 수정이 많아서 품질 관리 비중을 조금 더 높였으면 합니다.', 'accepted', '품질 관리를 25%로 올리고 프로젝트 관리를 20%로 조정했습니다.'],
  [3, '시연 준비는 기록이 남지 않아서, 프로젝트 관리 비중을 더 높여 주셨으면 합니다.', 'rejected', '오프라인 기여는 자기 기술·동료평가로 확인합니다. 가중치는 기록 기준으로 유지합니다.'],
];

// [작성자, 대상, 기준 항목, 무엇을 했는지, 근거, 연결 기록 index]
const REVIEWS = [
  [0, 3, 3, '시연 장비와 발표 환경을 맡아 현장 리허설을 두 번 진행했습니다.', '함께 수행', null],
  [1, 3, 3, '10/25, 10/31 오프라인 리허설 일정을 잡고 진행했습니다.', '직접 관찰', null],
  // 이다은(2)은 미제출 상태로 두어 제출 전 화면도 시연할 수 있게 한다
  [3, 0, 0, 'AI 분류 교차 확인과 근거 검증 기능을 PR로 올렸습니다.', '산출물 확인', 0],
  [3, 1, 2, '프롬프트 문서와 구조 문서를 정리해 저장소를 검증 가능하게 만들었습니다.', '산출물 확인', 7],
  [3, 2, 1, '보안 검토 지적을 조치하고 인쇄 레이아웃 오류를 고쳤습니다.', '산출물 확인', 10],
];

export async function seedDemo(newKey) {
  const id = randomUUID();
  await run(`INSERT INTO teams (id, course, name, project, start_date, deadline, repo, tools, categories, weights, criteria, criteria_meta, rubric, locked_at, closed_at, collected_at, demo, prof_key)
    VALUES (?, '캡스톤디자인(2)', '팀 3', '팀 기여도 기록 서비스', '2026-09-01', '2026-11-01', 'peach20040909/hanmankeum', ?, ?, ?, ?, ?, ?, '2026-10-10 10:00:00', '2026-11-01 23:59:59', '2026-11-01 23:59:59', 1, ?)`,
    id, JSON.stringify(['GitHub', 'Notion', '수동 기록']), JSON.stringify(DEMO_CRITERIA.map(c => c.name)), JSON.stringify(DEMO_CRITERIA.map(c => c.weight)),
    JSON.stringify(DEMO_CRITERIA), JSON.stringify(DEMO_META), DEMO_RUBRIC, newKey());
  const ids = [];
  for (const [name, role, github, email] of MEMBERS) {
    const { lastInsertRowid } = await run("INSERT INTO members (team_id, name, role, github, notion_email, key, confirmed_at) VALUES (?,?,?,?,?,?, '2026-10-09 09:30:00')",
      id, name, role, github, email, newKey());
    ids.push(lastInsertRowid);
  }
  // 규칙 판단을 함께 남겨 'AI·규칙 판단이 다른 기록(확인 필요)'과 'AI 도움 기록'이 시연에 보이게 함
  const recIds = [];
  for (const [i, [m, tool, kind, title, type, date, ref, reason, body, url]] of RECORDS.entries()) {
    const d = detectAI({ title, body });
    const { lastInsertRowid } = await run("INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by, rule_type, prompt_version, ai_assisted, ai_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'demo', ?,?,?,?)",
      id, ids[m], `demo:${i}`, tool, kind, title, body, url, ref, date, type, reason, ruleClassify({ kind, title }, DEMO_CRITERIA).type, PROMPT_VERSION, d.ai ? 1 : 0, d.note);
    recIds.push(lastInsertRowid);
  }
  const OPINION_AT = ['2026-10-08 14:20:00', '2026-10-08 16:05:00'];
  for (const [i, [m, text, status, reply]] of OPINIONS.entries()) await run('INSERT INTO opinions (team_id, member_id, text, status, reply, created_at) VALUES (?,?,?,?,?,?)', id, ids[m], text, status, reply, OPINION_AT[i] ?? '2026-09-09 16:05:00');
  await run("INSERT INTO statements (team_id, member_id, text, created_at) VALUES (?,?,?, '2026-11-02 11:00:00')",
    id, ids[3], '발표 자료와 시연 환경을 맡았고, 10/25와 10/31 두 차례 오프라인 리허설을 진행했습니다. 코드 작업은 팀원 노트북에서 함께해서 제 계정 커밋으로 남지 않았습니다.');
  for (const [from, to, axis, did, basis, rec] of REVIEWS) {
    await run("INSERT INTO peer_reviews (team_id, reviewer_id, target_id, period, axis, did, basis, record_id, created_at) VALUES (?,?,?, '전체 기간', ?,?,?,?, '2026-11-02 12:30:00')",
      id, ids[from], ids[to], axis, did, basis, rec == null ? null : recIds[rec]);
  }
  return id;
}
