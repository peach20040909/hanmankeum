// 테스트 전용 서버: 운영 자격·DB를 상속하지 않으며 .env도 읽지 않는다.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const name of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL', 'GITHUB_TOKEN', 'NOTION_TOKEN', 'NOTION_WEBHOOK_SECRET']) delete process.env[name];
const failure = process.argv.includes('--ai-failure');
const dir = mkdtempSync(join(tmpdir(), 'hmk-e2e-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.PORT = process.env.PORT || (failure ? '4174' : '4173');
if (process.argv.includes('--demo-fixtures')) {
  await (await import('./print-fixtures.mjs')).printFixtures();
  // 시연 도구 점검에서만 GitHub 외부 응답을 고정한다. 수집 라우트·분류·저장은 실제 실행한다.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'api.github.com') return realFetch(input, options);
    if (url.pathname.endsWith('/commits')) return Response.json([{
      sha: '0123456789abcdef0123456789abcdef01234567', parents: [{ sha: 'parent' }],
      author: { login: 'peach20040909' }, html_url: 'https://github.com/peach20040909/hanmankeum',
      commit: { message: 'feat: 자료 작성 기능 구현', author: { date: '2026-11-11T03:00:00Z' } },
    }]);
    if (/\/(pulls|pulls\/comments|issues)$/.test(url.pathname)) return Response.json([]);
    throw new Error('시연 fixture에서 예상하지 않은 GitHub 경로');
  };
}
let provider;
if (failure) {
  // 잘못된 임시 키로 실제 SDK 요청을 보내되 로컬 제공자가 401을 반환한다.
  // 인터넷·실제 크레딧·실키 없이 실패 → DB → API → UI 경로를 재현한다.
  provider = http.createServer((req, res) => {
    req.resume();
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid_api_key (local E2E provider)' } }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  process.env.ANTHROPIC_API_KEY = randomUUID();
}
await import('../server.js');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  provider?.close();
  const { client } = await import('../db.js');
  client.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
