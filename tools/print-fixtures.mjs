// 로컬 E2E DB에서만 만드는 기준 도입 전 팀. 운영 데이터·마이그레이션과 무관하다.
import { init, run } from '../db.js';
export async function printFixtures() {
  await init();
  for (const suffix of ['short', 'long', 'no-review']) {
    const id = `print-legacy-${suffix}`;
    await run(`INSERT INTO teams (id, course, name, project, deadline, categories, weights, locked_at, closed_at, prof_key)
      VALUES (?, '캡스톤디자인(2)', '팀 3', '캠퍼스 분실물 매칭 앱', '2026-11-01', ?, ?, '2026-10-01', '2026-11-01', ?)`,
    id, JSON.stringify(['만들기', '다듬기', '이끌기']), '[45,35,20]', id);
    const members = [];
    for (const name of ['가학생', '나학생', '다학생', '라학생']) {
      members.push((await run('INSERT INTO members (team_id, name, key) VALUES (?,?,?)', id, name, `${id}-${name}`)).lastInsertRowid);
    }
    for (let i = 0; i < 15; i++) await run(`INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, date, type, rule_type, classified_by, reason)
      VALUES (?,?,?, 'GitHub', 'Commit', ?, '2026-11-01', ?, ?, 'ai', '분류 근거')`,
    id, members[i % 3], `record-${i}`, `요구사항 ${i} 기능 구현과 테스트`, i % 3, i === 0 && suffix !== 'no-review' ? 1 : i % 3);
    const text = suffix === 'long'
      ? Array.from({ length: 110 }, (_, i) => `${i + 1}. 요구사항을 분석하고 테스트 결과와 변경 이유를 기록했습니다.`).join('\n')
      : Array.from({ length: 8 }, () => '요구사항을 분석하고 기능 구현과 검토 내용을 정리했습니다.').join('\n');
    await run('INSERT INTO statements (team_id, member_id, text) VALUES (?,?,?)', id, members[0], text);
    for (let i = 0; i < 3; i++) await run(`INSERT INTO peer_reviews (team_id, reviewer_id, target_id, period, axis, did, basis)
      VALUES (?,?,?, '전체 기간', ?, ?, '직접 관찰')`, id, members[i + 1], members[0], i, '요구사항 정리와 기능 검증에 함께 참여했습니다.');
  }
}
