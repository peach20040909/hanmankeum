// 착수 → 잠금 → 마감 → 동료평가 흐름과 권한을 실제 서버로 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3990 + Math.floor(Math.random() * 9);
const B = `http://localhost:${PORT}/api`;
const call = async (path, key, method = 'GET', body) => {
  const res = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

test('착수·권한·동료평가 흐름', async t => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DB_PATH: join(mkdtempSync(join(tmpdir(), 'hmk-')), 't.db') }, stdio: 'ignore' });
  t.after(() => srv.kill());
  for (let i = 0; i < 100; i++) { try { await fetch(B + '/join/x'); break; } catch { await new Promise(r => setTimeout(r, 50)); } }

  const { data: c } = await call('/teams', null, 'POST', { course: 'c', name: 'n', project: 'p', deadline: '2099-12-31', members: [{ name: 'A' }, { name: 'B' }] });
  const id = c.team.id, P = c.prof_key, [ka, kb] = c.team.members.map(m => m.key);
  assert.deepEqual(c.team.weights, [40, 35, 25]); // 균형 기본값
  assert.deepEqual(c.team.categories, ['만들기', '다듬기', '이끌기']);

  // 권한: 키 없음 거부, 학생은 다른 팀원 키를 못 봄
  assert.equal((await call(`/teams/${id}`)).status, 403);
  const sv = (await call(`/teams/${id}`, ka)).data;
  assert.equal(sv.role, 'student');
  assert.ok(sv.members.every(m => !m.key) && !sv.prof_key);

  // 가중치: 교수만, 합 100
  assert.equal((await call(`/teams/${id}/weights`, ka, 'PUT', { weights: [50, 30, 20] })).status, 403);
  assert.equal((await call(`/teams/${id}/weights`, P, 'PUT', { weights: [50, 30, 10] })).status, 400);
  assert.equal((await call(`/teams/${id}/weights`, P, 'PUT', { weights: [50, 30, 20] })).status, 200);
  await call(`/teams/${id}/opinions`, ka, 'POST', { text: '개선 비중을 높여 주세요' });
  const op = (await call(`/teams/${id}`, P)).data.opinions[0];
  assert.equal((await call(`/teams/${id}/opinions/${op.id}`, ka, 'PATCH', { status: 'accepted' })).status, 403);
  await call(`/teams/${id}/opinions/${op.id}`, P, 'PATCH', { status: 'accepted' });
  assert.equal((await call(`/teams/${id}`, kb)).data.opinions.length, 0); // 남의 의견은 안 보임

  // 잠금: 전원 확인 전 거부
  await call(`/teams/${id}/confirm`, ka, 'POST');
  assert.equal((await call(`/teams/${id}/lock`, P, 'POST')).status, 409);
  await call(`/teams/${id}/confirm`, kb, 'POST');
  const locked = (await call(`/teams/${id}/lock`, P, 'POST')).data;
  assert.ok(locked.locked_at && locked.accepted_opinions === 1);

  // 학기 중: 리포트·기록·동료평가 닫힘
  assert.equal((await call(`/teams/${id}/report`, P)).status, 403);
  assert.equal((await call(`/teams/${id}/records`, ka)).status, 403);
  await call(`/teams/${id}/records`, ka, 'POST', { tool: 'Docs', title: '요구사항 정의서 작성' });
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [] })).status, 409);

  // 마감 후: 동료평가 1회, 리포트는 교수만
  await call(`/teams/${id}/close`, P, 'POST');
  const [ma, mb] = locked.members;
  const item = { target_id: mb.id, axis: 2, did: '회의 일정을 잡았습니다', basis: '직접 관찰' };
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [{ ...item, did: '' }] })).status, 400);
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [item] })).status, 200);
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [item] })).status, 409);
  assert.equal((await call(`/teams/${id}/report`, kb)).status, 403);
  const rep = (await call(`/teams/${id}/report`, P)).data;
  assert.equal(rep.reviews.length, 1);
  assert.equal(rep.reviews[0].reviewer, '익명 A'); // 교수 화면에도 이름 없음
  assert.ok(!('reviewer_id' in rep.reviews[0]));
  assert.equal(rep.scores.find(s => s.member_id === ma.id).score, 100); // 동료평가는 기여율에 미반영
  assert.equal(rep.scores.find(s => s.member_id === mb.id).score, 0);

  // 첨부: Vercel 본문 한도(4.5MB) 때문에 파일당 3MB까지. 본인 첨부만 열람
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const over = await call(`/teams/${id}/statements`, kb, 'POST', { text: '큰 첨부', files: [{ name: 'b.png', mime: 'image/png', data: Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64') }] });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /3MB/);
  const ok = await call(`/teams/${id}/statements`, ka, 'POST', { text: '오프라인 리허설 진행', files: [{ name: 'a.png', mime: 'image/png', data: png.toString('base64') }] });
  assert.equal(ok.status, 200);
  const fileId = ok.data.statements[0].files[0].id;
  assert.equal((await fetch(`${B}/files/${fileId}?k=${encodeURIComponent(ka)}`)).status, 200);
  assert.equal((await fetch(`${B}/files/${fileId}?k=${encodeURIComponent(kb)}`)).status, 403); // 남의 첨부
});

test('AI 리터러시: 확인 필요 · AI 도움 표시', async t => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: PORT + 10, DB_PATH: join(mkdtempSync(join(tmpdir(), 'hmk-')), 't.db'), ANTHROPIC_API_KEY: '' }, stdio: 'ignore' });
  t.after(() => srv.kill());
  const B2 = `http://localhost:${PORT + 10}/api`;
  const c2 = async (path, key, method = 'GET', body) => {
    const res = await fetch(B2 + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  for (let i = 0; i < 100; i++) { try { await fetch(B2 + '/join/x'); break; } catch { await new Promise(r => setTimeout(r, 50)); } }

  // 시연 팀: AI·규칙 판단이 다른 기록 2건. 기록은 실제 저장소의 커밋·PR이라
  // AI 도움 표시는 커밋에 실제로 붙어 있는 공동 작성자 표시에서만 나온다.
  const { data: d } = await c2('/demo', null, 'POST');
  const id = d.team.id, P = d.prof_key;
  assert.equal(d.team.needs_review, 2);
  const recs = (await c2(`/teams/${id}/records`, P)).data;
  assert.ok(recs.length > 0 && recs.every(r => r.url), '시연 기록은 모두 원본 링크를 가진다');
  // 표시가 있는 기록만 AI 도움으로 잡히는지 (지어낸 플래그가 아님을 확인)
  const marked = recs.filter(r => /Co-Authored-By:\s*Claude|Generated with \[Claude/i.test(r.body || ''));
  assert.equal(d.team.ai_assisted, marked.length);
  assert.ok(marked.length >= 2 && marked.length < recs.length);
  const flagged = recs.filter(r => r.rule_type !== r.type);
  assert.ok(flagged.every(r => r.prompt_version === 'mrl-3axis-v2'));

  // 교수가 축을 그대로 두고 저장해도 '확인 완료'로 빠짐, 원래 근거는 보존
  const r0 = flagged[0];
  const saved = (await c2(`/teams/${id}/records/${r0.id}`, P, 'PATCH', { type: r0.type })).data;
  assert.equal(saved.classified_by, 'professor');
  assert.ok(saved.reason.includes(r0.reason));
  assert.equal((await c2(`/teams/${id}`, P)).data.needs_review, 1);

  // 학생 화면에는 확인 필요 개수를 내보내지 않음
  const sk = (await c2(`/teams/${id}`, P)).data.members[0].key;
  assert.ok(!('needs_review' in (await c2(`/teams/${id}`, sk)).data));

  // 생성형 AI: 요약·초안 (키 없음 → 규칙 문장, 그래도 근거 검증 통과분만)
  const members = (await c2(`/teams/${id}`, P)).data.members;
  const seo = members.find(m => m.name === '김서연'), min = members.find(m => m.name === '최민재');
  assert.equal((await c2(`/teams/${id}/members/${seo.id}/summary`, sk, 'POST')).status, members[0].id === seo.id ? 200 : 403); // 남의 요약은 못 만듦
  const sum = (await c2(`/teams/${id}/members/${seo.id}/summary`, P, 'POST')).data.summaries.find(s => s.member_id === seo.id);
  assert.equal(sum.by, 'rule');
  const seoRecs = recs.filter(r => r.member_id === seo.id).map(r => r.id);
  assert.ok(sum.sentences.length && sum.sentences.every(s => s.refs.length && s.refs.every(x => seoRecs.includes(x))));
  assert.equal((await c2(`/teams/${id}/members/${min.id}/summary`, P, 'POST')).status, 409); // 기록 0건은 요약 안 함

  const ks = seo.key;
  await c2(`/teams/${id}/members/${seo.id}/summary`, ks, 'POST');
  const ob = (await c2(`/teams/${id}/summary/objection`, ks, 'POST', { index: 0, text: '공동 작업이었습니다' })).data;
  assert.equal(ob.summaries[0].sentences[0].objection, '공동 작업이었습니다');
  assert.equal(ob.summaries.length, 1); // 학생은 본인 요약만 봄
  assert.equal((await c2(`/teams/${id}/members/${seo.id}/summary`, P, 'POST')).status, 409); // 이의가 있으면 다시 만들기로 지우지 못함

  const dr = (await c2(`/teams/${id}/draft`, ks, 'POST')).data.draft;
  assert.match(dr.text, /\(근거: /);
  assert.equal((await c2(`/teams/${id}/statements`, ks, 'POST', { text: dr.text })).status, 400); // 대조 확인 체크 필요
  const st = (await c2(`/teams/${id}/statements`, ks, 'POST', { text: `${dr.text}\n발표 리허설도 맡았습니다.`, checked: true })).data.statements[0];
  assert.equal(st.draft_checked, 1);
  assert.equal(st.draft_diff.added, 1);
  assert.equal((await c2(`/teams/${id}/draft`, ks, 'POST')).status, 409); // 제출 후 초안 재생성 불가
});

// 보안 검토(2026-11-01)에서 나온 취약점의 재발 방지
test('학생이 와일드카드 이메일로 남의 기록을 가져가지 못한다', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hmk-sec-'));
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT + 20), DB_PATH: join(dir, 'x.db') }, stdio: 'ignore' });
  t.after(() => srv.kill());
  const B2 = `http://localhost:${PORT + 20}/api`;
  const c = async (path, key, method = 'GET', body) => {
    const res = await fetch(B2 + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  for (let i = 0; i < 60; i++) { try { await fetch(B2 + '/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

  const t1 = (await c('/teams', null, 'POST', {
    course: '보안', name: '팀', project: '검증', deadline: '2027-01-01',
    members: [{ name: '가' }, { name: '나' }],
  })).data.team;
  const [m1] = t1.members;

  // LIKE 와일드카드가 들어간 이메일은 거부되어야 한다
  for (const email of ['%@%', '_@_', '%@mju.ac.kr']) {
    assert.equal((await c(`/teams/${t1.id}/members/${m1.id}/notion`, t1.prof_key, 'PUT', { email })).status, 400, email);
  }
  // 정상 이메일은 통과
  assert.equal((await c(`/teams/${t1.id}/members/${m1.id}/notion`, t1.prof_key, 'PUT', { email: 'a@mju.ac.kr' })).status, 200);
  // 같은 팀의 다른 팀원이 같은 이메일을 가져갈 수 없다
  assert.equal((await c(`/teams/${t1.id}/members/${t1.members[1].id}/notion`, t1.prof_key, 'PUT', { email: 'a@mju.ac.kr' })).status, 409);

  // 요약 이의: index 가 속성 키로 쓰이지 않는다
  for (const index of ['__proto__', 'constructor', 'length', -1, 1.5]) {
    const r = await c(`/teams/${t1.id}/summary/objection`, m1.key, 'POST', { index, text: 'x' });
    assert.ok(r.status === 400 || r.status === 404, `${index} → ${r.status}`);
  }
  assert.equal(typeof ([].objection), 'undefined'); // Array.prototype 오염 없음
});
