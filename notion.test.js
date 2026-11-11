import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'hmk-notion-'));
process.env.DB_PATH = join(dir, 'test.db');
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
process.env.NOTION_TOKEN = randomUUID();
process.env.NOTION_WEBHOOK_SECRET = randomUUID();
const { handle, handleNotionEvent } = await import('./handler.js');
const { all, client } = await import('./db.js');
after(async () => { client.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const call = async (path, key, method = 'GET', body) => {
  const res = await handle(new Request(`http://localhost/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  assert.equal(res.status, 200);
  return res.json();
};

async function fixture(t) {
  // 외부 조회만 대체한다. 분류기·권한·DB·서명 검증은 실제 코드를 실행한다.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('테스트에서 외부 네트워크는 허용하지 않습니다.'); });
  const root = randomUUID(), page = randomUUID(), author = randomUUID();
  const { team, prof_key } = await call('/teams', null, 'POST', {
    course: 'Notion 검증', name: '팀', project: '자료 조사', deadline: '2099-12-31', notion: root,
    criteria: [
      { name: '자료 작성', weight: 60, keywords: ['명세'], kinds: ['페이지 생성'] },
      { name: '동료 검토', weight: 40, keywords: ['검토'], kinds: ['남의 문서 편집'] },
    ],
    members: [{ name: '가', notion_email: 'a@example.com' }, { name: '나', notion_email: 'b@example.com' }],
  });
  for (const m of team.members) await call(`/teams/${team.id}/confirm`, m.key, 'POST');
  await call(`/teams/${team.id}/lock`, prof_key, 'POST');
  const api = {
    ancestors: async id => { assert.equal(id, page); return [page, root]; },
    pageInfo: async id => { assert.equal(id, page); return { title: '이름만 있는 페이지', url: `https://www.notion.so/${page}`, createdBy: author }; },
    userInfo: async id => { assert.equal(id, author); return { name: '가', email: 'a@example.com' }; },
  };
  const event = type => ({
    id: randomUUID(), type, entity: { type: 'page', id: page }, authors: [{ type: 'person', id: author }],
    timestamp: '2026-11-11T03:00:00.000Z', data: { updated_blocks: [randomUUID()] },
  });
  const records = () => all('SELECT * FROM records WHERE team_id = ?', team.id);
  return { team, api, event, records, author, prof_key };
}

test('Notion 페이지 생성은 교수 kinds 기준으로 분류하고 출처·작성자·버전을 저장한다', async t => {
  const f = await fixture(t);
  await handleNotionEvent(f.event('page.created'), f.api);
  const rows = await f.records();
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.tool, 'Notion');
  assert.equal(r.kind, '페이지 생성');
  assert.equal(r.type, 0);
  assert.equal(r.rule_type, 0);
  assert.equal(r.classified_by, 'rule');
  assert.equal(r.prompt_version, null); // 규칙 경로는 LLM 프롬프트를 실행하지 않는다.
  assert.equal(r.member_id, f.team.members[0].id);
  assert.equal(r.title, '이름만 있는 페이지');
  assert.match(r.reason, /자료 작성/);
});

test('Notion 타인이 만든 페이지 편집은 남의 문서 편집으로 구분한다', async t => {
  const f = await fixture(t);
  f.api.pageInfo = async () => ({ title: '공유 자료', url: null, createdBy: randomUUID() });
  await handleNotionEvent(f.event('page.content_updated'), f.api);
  const [r] = await f.records();
  assert.ok(r);
  assert.equal(r.kind, '남의 문서 편집');
  assert.equal(r.type, 1);
  assert.equal(r.rule_type, 1);
  assert.equal(r.classified_by, 'rule');
  assert.equal(r.prompt_version, null);
});

test('Notion 어떤 교수 기준에도 맞지 않는 본인 편집은 기준 밖으로 저장한다', async t => {
  const f = await fixture(t);
  await handleNotionEvent(f.event('page.content_updated'), f.api);
  const [r] = await f.records();
  assert.ok(r);
  assert.equal(r.kind, '문서 편집');
  assert.equal(r.type, null);
  assert.equal(r.rule_type, null);
  assert.equal(r.classified_by, 'rule');
  assert.equal(r.prompt_version, null);
});

test('Notion 같은 날짜의 중복 이벤트는 한 건이며 팀 밖 페이지는 저장하지 않는다', async t => {
  const f = await fixture(t);
  const ev = f.event('page.created');
  await handleNotionEvent(ev, f.api);
  await handleNotionEvent(ev, f.api);
  assert.equal((await f.records()).length, 1);
  f.api.ancestors = async () => [randomUUID()];
  await handleNotionEvent(f.event('page.content_updated'), f.api);
  assert.equal((await f.records()).length, 1);
});

test('Notion 웹훅은 틀린 서명을 거부하고 기록을 만들지 않는다', async t => {
  const f = await fixture(t);
  const body = JSON.stringify(f.event('page.created'));
  const wrongSecret = randomUUID();
  const signature = `sha256=${createHmac('sha256', wrongSecret).update(body).digest('hex')}`;
  const res = await handle(new Request('http://localhost/api/webhooks/notion', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Notion-Signature': signature }, body,
  }));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /서명/);
  assert.equal((await f.records()).length, 0);
});
