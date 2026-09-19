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
  assert.deepEqual(c.team.weights, [30, 25, 25, 20]); // 균형 기본값
  assert.deepEqual(c.team.categories, ['산출물 생성', '산출물 개선', '조율/관리', '의사소통']);

  // 권한: 키 없음 거부, 학생은 다른 팀원 키를 못 봄
  assert.equal((await call(`/teams/${id}`)).status, 403);
  const sv = (await call(`/teams/${id}`, ka)).data;
  assert.equal(sv.role, 'student');
  assert.ok(sv.members.every(m => !m.key) && !sv.prof_key);

  // 가중치: 교수만, 합 100
  assert.equal((await call(`/teams/${id}/weights`, ka, 'PUT', { weights: [40, 30, 15, 15] })).status, 403);
  assert.equal((await call(`/teams/${id}/weights`, P, 'PUT', { weights: [40, 30, 15, 10] })).status, 400);
  assert.equal((await call(`/teams/${id}/weights`, P, 'PUT', { weights: [40, 30, 15, 15] })).status, 200);

  // 동의 전에는 확인·의견 불가
  assert.equal((await call(`/teams/${id}/confirm`, ka, 'POST')).status, 403);
  for (const k of [ka, kb]) assert.equal((await call(`/teams/${id}/consent`, k, 'POST', { agree: true })).status, 200);
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
  const item = { target_id: mb.id, period: '전체 기간', axis: 2, did: '회의 일정을 잡았습니다', basis: '직접 관찰' };
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [{ ...item, did: '' }] })).status, 400);
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [item] })).status, 200);
  assert.equal((await call(`/teams/${id}/peer-reviews`, ka, 'POST', { items: [item] })).status, 409);
  assert.equal((await call(`/teams/${id}/report`, kb)).status, 403);
  const rep = (await call(`/teams/${id}/report`, P)).data;
  assert.equal(rep.reviews.length, 1);
  assert.equal(rep.scores.find(s => s.member_id === ma.id).score, 100); // 동료평가는 기여율에 미반영
  assert.equal(rep.scores.find(s => s.member_id === mb.id).score, 0);
});
