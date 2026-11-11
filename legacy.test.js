import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'hmk-legacy-'));
process.env.DB_PATH = join(dir, 'test.db');
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
const { handle, criteriaOf } = await import('./handler.js');
const { init, get, run, client } = await import('./db.js');
after(async () => { client.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test('옛 팀 출처는 읽기 시 legacy로 표시하며 DB·기준·점수는 보존한다', async () => {
  await init();
  await run(`INSERT INTO teams (id, course, name, project, deadline, categories, weights, prof_key)
    VALUES ('old', 'c', 'n', 'p', '2026-11-01', ?, '[45,35,20]', 'prof')`, JSON.stringify(['만들기', '다듬기', '이끌기']));
  const before = await get("SELECT * FROM teams WHERE id = 'old'");
  const res = await handle(new Request('http://localhost/api/teams/old', { headers: { 'X-Key': 'prof' } }));
  assert.equal(res.status, 200);
  const team = await res.json();
  assert.deepEqual(team.criteria_meta, { by: 'legacy' });
  assert.deepEqual(team.criteria, criteriaOf(before));
  assert.deepEqual(team.weights, [45, 35, 20]);
  assert.deepEqual(await get("SELECT * FROM teams WHERE id = 'old'"), before);
});
