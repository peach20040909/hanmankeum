import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { computeScores } from './score.js';
import { fetchGitHub, classify } from './collect.js';
import { seedDemo } from './seed.js';
import { verifySignature, parsePageId, ancestors, pageInfo, userInfo, KIND } from './notion.js';

const db = new DatabaseSync(process.env.DB_PATH || 'hanmankeum.db');
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, course TEXT NOT NULL, name TEXT NOT NULL, project TEXT NOT NULL,
  start_date TEXT, deadline TEXT NOT NULL, repo TEXT, tools TEXT NOT NULL DEFAULT '["GitHub"]',
  categories TEXT NOT NULL, weights TEXT NOT NULL, locked_at TEXT, closed_at TEXT,
  collected_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, github TEXT, confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL, login TEXT,
  ext_id TEXT NOT NULL, tool TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  url TEXT, ref TEXT, date TEXT, type INTEGER, reason TEXT, classified_by TEXT,
  UNIQUE(team_id, ext_id)
);
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(team_id, member_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL
);`);

// 기존 DB에 새 컬럼 추가
for (const [table, col] of [['teams', 'notion_page'], ['members', 'notion_email']]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
}

// 무료 호스팅은 재시작 시 DB가 비므로, 비어 있으면 시연용 예시 팀을 채움
if (!db.prepare('SELECT count(*) n FROM teams').get().n) seedDemo(db);

const MAX_FILE =5 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const toolsOf = (repo, notionPage) => JSON.stringify([repo && 'GitHub', notionPage && 'Notion', '수동 기록'].filter(Boolean));
const isClosed =t => !!t.closed_at || Date.now() > new Date(`${t.deadline}T23:59:59+09:00`).getTime();

function getTeam(id) {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) || fail(404, '팀을 찾을 수 없습니다.');
  return {
    ...t, tools: JSON.parse(t.tools), categories: JSON.parse(t.categories), weights: JSON.parse(t.weights),
    closed: isClosed(t),
    members: db.prepare('SELECT * FROM members WHERE team_id = ? ORDER BY id').all(id),
    record_count: db.prepare('SELECT count(*) n FROM records WHERE team_id = ?').get(id).n,
    unmatched: db.prepare('SELECT count(*) n FROM records WHERE team_id = ? AND member_id IS NULL').get(id).n,
    statements: db.prepare('SELECT id, member_id, text, created_at FROM statements WHERE team_id = ?').all(id)
      .map(s => ({ ...s, files: db.prepare('SELECT id, name, mime FROM files WHERE statement_id = ?').all(s.id) })),
  };
}

function validateWeights(categories, weights) {
  if (!Array.isArray(categories) || !Array.isArray(weights) || categories.length !== weights.length || categories.length < 1 || categories.length > 8)
    fail(400, '기여 유형은 1~8개여야 합니다.');
  if (categories.some(c => typeof c !== 'string' || !c.trim() || c.length > 20)) fail(400, '유형 이름을 확인해 주세요.');
  if (weights.some(w => !Number.isInteger(w) || w < 0 || w > 100)) fail(400, '가중치는 0~100 정수입니다.');
  if (weights.reduce((a, b) => a + b, 0) !== 100) fail(400, '가중치 합계는 100이어야 합니다.');
}

const text = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim()) fail(400, `${name}을(를) 입력해 주세요.`);
  if (v.length > max) fail(400, `${name}이(가) 너무 깁니다.`);
  return v.trim();
};

// ponytail: 로그인 없음 — 팀 링크(UUID)를 아는 사람이 교수/학생 화면을 전환. 실서비스 전 학교 SSO·역할 권한 추가.
const routes = [
  ['GET', /^\/api\/teams$/, () =>
    db.prepare('SELECT id, course, name, project, deadline, locked_at, closed_at FROM teams ORDER BY created_at DESC').all()
      .map(t => ({ ...t, closed: isClosed(t), member_count: db.prepare('SELECT count(*) n FROM members WHERE team_id = ?').get(t.id).n }))],

  ['POST', /^\/api\/teams$/, (_, b) => {
    const members = Array.isArray(b.members) ? b.members.filter(m => m?.name?.trim()) : [];
    if (members.length < 2 || members.length > 10) fail(400, '팀원은 2~10명입니다.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '')) fail(400, '마감일을 입력해 주세요.');
    if (b.repo && !/^[\w.-]+\/[\w.-]+$/.test(b.repo)) fail(400, 'GitHub 저장소는 owner/name 형식입니다.');
    const notionPage = b.notion ? parsePageId(b.notion) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
    validateWeights(b.categories, b.weights);
    const id = randomUUID();
    db.prepare('INSERT INTO teams (id, course, name, project, start_date, deadline, repo, notion_page, tools, categories, weights) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, text(b.course, 60, '과목명'), text(b.name, 30, '팀 이름'), text(b.project, 60, '프로젝트명'), b.start_date || null, b.deadline,
        b.repo || null, notionPage, toolsOf(b.repo, notionPage), JSON.stringify(b.categories.map(c => c.trim())), JSON.stringify(b.weights));
    const ins = db.prepare('INSERT INTO members (team_id, name, role, github, notion_email) VALUES (?,?,?,?,?)');
    for (const m of members) {
      const email = (m.notion_email || '').trim().toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
      ins.run(id, text(m.name, 20, '이름'), (m.role || '').slice(0, 30), (m.github || '').trim().replace(/^@/, '') || null, email);
    }
    return getTeam(id);
  }],

  // Notion 루트 페이지 연결/변경 (하위 페이지 편집까지 수집)
  ['PUT', /^\/api\/teams\/([\w-]+)\/notion$/, ([id], b) => {
    const t = getTeam(id);
    if (t.closed) fail(409, '마감된 팀입니다.');
    const page = b.url ? parsePageId(b.url) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
    db.prepare('UPDATE teams SET notion_page = ?, tools = ? WHERE id = ?').run(page, toolsOf(t.repo, page), id);
    return getTeam(id);
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/members\/(\d+)\/notion$/, ([id, mid], b) => {
    const email = String(b.email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
    getTeam(id);
    db.prepare('UPDATE members SET notion_email = ? WHERE id = ? AND team_id = ?').run(email, mid, id);
    // 이미 들어온 미매칭 Notion 기록도 연결
    if (email) db.prepare("UPDATE records SET member_id = ? WHERE team_id = ? AND member_id IS NULL AND tool = 'Notion' AND lower(login) LIKE ?").run(mid, id, `%<${email}>`);
    return getTeam(id);
  }],

  ['POST', /^\/api\/demo$/, () => getTeam(seedDemo(db))],

  ['GET', /^\/api\/teams\/([\w-]+)$/, ([id]) => getTeam(id)],

  ['DELETE', /^\/api\/teams\/([\w-]+)$/, ([id]) => {
    getTeam(id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(id); // 팀원·기록·서술·첨부는 CASCADE
    return { ok: true };
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/weights$/, ([id], b) => {
    const t = getTeam(id);
    if (t.locked_at) fail(409, '이미 잠긴 기준은 변경할 수 없습니다.');
    validateWeights(b.categories, b.weights);
    db.prepare('UPDATE teams SET categories = ?, weights = ? WHERE id = ?').run(JSON.stringify(b.categories.map(c => c.trim())), JSON.stringify(b.weights), id);
    db.prepare('UPDATE members SET confirmed_at = NULL WHERE team_id = ?').run(id); // 기준이 바뀌면 다시 확인
    return getTeam(id);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/members\/(\d+)\/confirm$/, ([id, mid]) => {
    if (getTeam(id).locked_at) fail(409, '이미 잠겼습니다.');
    db.prepare("UPDATE members SET confirmed_at = datetime('now') WHERE id = ? AND team_id = ?").run(mid, id);
    return getTeam(id);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/lock$/, ([id]) => {
    const t = getTeam(id);
    if (t.locked_at) fail(409, '이미 잠겼습니다.');
    if (t.members.some(m => !m.confirmed_at)) fail(409, '모든 팀원이 확인해야 잠글 수 있습니다.');
    db.prepare("UPDATE teams SET locked_at = datetime('now') WHERE id = ?").run(id);
    return getTeam(id);
  }],

  // 시연용: 마감일 전이라도 지금 마감 처리
  ['POST', /^\/api\/teams\/([\w-]+)\/close$/, ([id]) => {
    if (!getTeam(id).locked_at) fail(409, '착수 기준을 잠근 뒤 마감할 수 있습니다.');
    db.prepare("UPDATE teams SET closed_at = datetime('now') WHERE id = ?").run(id);
    return getTeam(id);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/collect$/, async ([id]) => {
    const t = getTeam(id);
    if (!t.locked_at) fail(409, '착수 기준을 잠근 뒤 수집할 수 있습니다.');
    if (!t.repo) fail(400, '연결된 GitHub 저장소가 없습니다.');
    const byLogin = new Map(t.members.filter(m => m.github).map(m => [m.github.toLowerCase(), m.id]));
    const known = new Set(db.prepare('SELECT ext_id FROM records WHERE team_id = ?').all(id).map(r => r.ext_id));
    let items;
    try { items = (await fetchGitHub(t.repo)).filter(it => !known.has(it.ext_id)); } catch (e) { fail(502, e.message); }
    const ins = db.prepare('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let ai = 0;
    for (let i = 0; i < items.length; i += 80) {
      const chunk = items.slice(i, i + 80);
      const cls = await classify(chunk, t.categories, t.weights);
      chunk.forEach((it, j) => {
        if (cls[j].by === 'ai') ai++;
        ins.run(id, byLogin.get((it.login || '').toLowerCase()) ?? null, it.login || null, it.ext_id, it.tool, it.kind, it.title.slice(0, 300),
          (it.body || '').slice(0, 4000), it.url, it.ref, it.date, cls[j].type, cls[j].reason, cls[j].by);
      });
    }
    db.prepare("UPDATE teams SET collected_at = datetime('now') WHERE id = ?").run(id);
    return { added: items.length, ai, team: getTeam(id) };
  }],

  // Notion · Docs 등 아직 API 연동 전인 도구의 기록을 링크로 추가
  ['POST', /^\/api\/teams\/([\w-]+)\/records$/, async ([id], b) => {
    const t = getTeam(id);
    if (!t.locked_at) fail(409, '착수 기준을 잠근 뒤 기록할 수 있습니다.');
    if (!t.members.some(m => m.id === b.member_id)) fail(400, '팀원을 선택해 주세요.');
    if (b.url && !/^https?:\/\//.test(b.url)) fail(400, '링크는 http(s)로 시작해야 합니다.');
    const item = { tool: text(b.tool, 20, '도구'), kind: text(b.kind || '문서 편집', 20, '활동 종류'), title: text(b.title, 200, '제목'), body: (b.body || '').slice(0, 4000) };
    const [c] = Number.isInteger(b.type) && b.type >= 0 && b.type < t.categories.length
      ? [{ type: b.type, reason: '작성자가 직접 선택한 유형입니다.', by: 'manual' }]
      : await classify([item], t.categories, t.weights);
    db.prepare('INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, b.member_id, `manual:${randomUUID()}`, item.tool, item.kind, item.title, item.body, b.url || null, `${item.tool} 링크`,
        b.date || new Date().toISOString(), c.type, c.reason, c.by);
    return getTeam(id);
  }],

  ['GET', /^\/api\/teams\/([\w-]+)\/records$/, ([id]) => {
    getTeam(id);
    return db.prepare('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC').all(id);
  }],

  // 교수 재분류
  ['PATCH', /^\/api\/records\/(\d+)$/, ([rid], b) => {
    const r = db.prepare('SELECT * FROM records WHERE id = ?').get(rid) || fail(404, '기록이 없습니다.');
    const t = getTeam(r.team_id);
    if (b.type !== undefined) {
      if (!Number.isInteger(b.type) || b.type < 0 || b.type >= t.categories.length) fail(400, '유형이 올바르지 않습니다.');
      db.prepare("UPDATE records SET type = ?, reason = ?, classified_by = 'professor' WHERE id = ?").run(b.type, '교수가 원자료를 확인하고 유형을 조정했습니다.', rid);
    }
    if (b.member_id !== undefined) {
      if (b.member_id !== null && !t.members.some(m => m.id === b.member_id)) fail(400, '팀원이 올바르지 않습니다.');
      db.prepare('UPDATE records SET member_id = ? WHERE id = ?').run(b.member_id, rid);
    }
    return db.prepare('SELECT * FROM records WHERE id = ?').get(rid);
  }],

  ['GET', /^\/api\/teams\/([\w-]+)\/report$/, ([id]) => {
    const t = getTeam(id);
    if (!t.closed) fail(403, '학기 중에는 기여도를 산출하지 않습니다. 마감 후 1회 산출합니다.');
    const records = db.prepare('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC').all(id);
    return { team: t, scores: computeScores(t.members, records, t.weights), records };
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/statements$/, ([id], b) => {
    const t = getTeam(id);
    if (!t.closed) fail(409, '마감 후 작성할 수 있습니다.');
    if (!t.members.some(m => m.id === b.member_id)) fail(400, '팀원을 선택해 주세요.');
    if (t.statements.some(s => s.member_id === b.member_id)) fail(409, '서술은 1회만 제출할 수 있습니다.');
    const files = Array.isArray(b.files) ? b.files : [];
    if (files.length > 5) fail(400, '첨부는 5개까지입니다.');
    const decoded = files.map(f => {
      if (!/^(image\/[\w.+-]+|application\/pdf)$/.test(f?.mime || '')) fail(400, '이미지·PDF만 첨부할 수 있습니다.');
      const data = Buffer.from(String(f.data || ''), 'base64');
      if (!data.length || data.length > MAX_FILE) fail(400, '파일은 5MB 이하여야 합니다.');
      return { name: String(f.name || 'file').slice(0, 100), mime: f.mime, data };
    });
    const { lastInsertRowid: sid } = db.prepare('INSERT INTO statements (team_id, member_id, text) VALUES (?,?,?)').run(id, b.member_id, text(b.text, 1000, '서술'));
    for (const f of decoded) db.prepare('INSERT INTO files (statement_id, name, mime, data) VALUES (?,?,?,?)').run(sid, f.name, f.mime, f.data);
    return getTeam(id);
  }],
];

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 40 * 1024 * 1024) fail(413, '요청이 너무 큽니다.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const raw = await readRaw(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString()); } catch { fail(400, 'JSON 형식이 아닙니다.'); }
}

// Notion 웹훅 이벤트 → 팀 루트 페이지 하위인지 확인 → 편집자별 기록
// 같은 페이지·같은 편집자·같은 날(KST)은 1건으로 합침 (반복 편집 부풀리기 완화)
async function handleNotionEvent(ev) {
  if (!KIND[ev.type] || ev.entity?.type !== 'page') return;
  const teams = db.prepare('SELECT * FROM teams WHERE notion_page IS NOT NULL AND locked_at IS NOT NULL').all().filter(t => !isClosed(t));
  if (!teams.length) return;
  if (!process.env.NOTION_TOKEN) return console.warn('[Notion] NOTION_TOKEN이 없어 이벤트를 처리하지 못했습니다.');
  const pageId = ev.entity.id;
  const chain = await ancestors(pageId);
  const team = teams.find(t => chain.includes(t.notion_page));
  if (!team) return;
  const authors = (ev.authors || []).filter(a => a.type === 'person');
  if (!authors.length) return;
  const { title, url } = await pageInfo(pageId);
  const members = db.prepare('SELECT * FROM members WHERE team_id = ?').all(team.id);
  const item = { tool: 'Notion', kind: KIND[ev.type], title, body: '' };
  const [c] = await classify([item], JSON.parse(team.categories), JSON.parse(team.weights));
  const day = new Date(new Date(ev.timestamp).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  for (const a of authors) {
    const u = await userInfo(a.id);
    const member = u.email && members.find(m => m.notion_email === u.email);
    const blocks = ev.data?.updated_blocks?.length;
    db.prepare('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(team.id, member?.id ?? null, `${u.name} <${u.email || a.id}>`, `notion:${pageId}:${a.id}:${day}`, 'Notion', item.kind, title,
        blocks ? `블록 ${blocks}개 변경` : '', url, `Notion · ${day}`, ev.timestamp, c.type, c.reason, c.by);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  try {
    const file = url.pathname.match(/^\/api\/files\/(\d+)$/);
    if (file && req.method === 'GET') {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(file[1]) || fail(404, '파일이 없습니다.');
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" });
      return res.end(f.data);
    }
    if (url.pathname === '/api/webhooks/notion' && req.method === 'POST') {
      const raw = await readRaw(req);
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { fail(400, 'JSON 형식이 아닙니다.'); }
      // 구독 생성 직후 1회: 이 토큰을 Notion 화면에 붙여넣고, NOTION_WEBHOOK_SECRET 환경변수로 등록
      if (ev.verification_token && !ev.type) {
        console.log(`[Notion] verification_token: ${ev.verification_token}`);
        return send(200, { ok: true });
      }
      if (!verifySignature(raw, req.headers['x-notion-signature'], process.env.NOTION_WEBHOOK_SECRET)) fail(401, '서명이 올바르지 않습니다.');
      send(200, { ok: true });
      return handleNotionEvent(ev).catch(e => console.error('[Notion] 이벤트 처리 실패:', e.message));
    }
    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && method === req.method) return send(200, await handler(m.slice(1), await readBody(req)));
      }
      fail(404, '없는 API입니다.');
    }
    const name = ['/app.js', '/style.css'].includes(url.pathname) ? url.pathname : '/index.html';
    send(200, await readFile(new URL(`./public${name}`, import.meta.url)), MIME[name.slice(name.lastIndexOf('.'))]);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : '서버 오류가 발생했습니다.' });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`한만큼 → http://localhost:${port}`));
