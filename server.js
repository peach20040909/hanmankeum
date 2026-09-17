import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { computeScores } from './score.js';
import { fetchGitHub, classify } from './collect.js';
import { seedDemo } from './seed.js';

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

// 무료 호스팅은 재시작 시 DB가 비므로, 비어 있으면 시연용 예시 팀을 채움
if (!db.prepare('SELECT count(*) n FROM teams').get().n) seedDemo(db);

const MAX_FILE =5 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const isClosed = t => !!t.closed_at || Date.now() > new Date(`${t.deadline}T23:59:59+09:00`).getTime();

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
    validateWeights(b.categories, b.weights);
    const id = randomUUID();
    db.prepare('INSERT INTO teams (id, course, name, project, start_date, deadline, repo, tools, categories, weights) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, text(b.course, 60, '과목명'), text(b.name, 30, '팀 이름'), text(b.project, 60, '프로젝트명'), b.start_date || null, b.deadline,
        b.repo || null, JSON.stringify(b.repo ? ['GitHub', '수동 기록'] : ['수동 기록']), JSON.stringify(b.categories.map(c => c.trim())), JSON.stringify(b.weights));
    const ins = db.prepare('INSERT INTO members (team_id, name, role, github) VALUES (?,?,?,?)');
    for (const m of members) ins.run(id, text(m.name, 20, '이름'), (m.role || '').slice(0, 30), (m.github || '').trim().replace(/^@/, '') || null);
    return getTeam(id);
  }],

  ['POST', /^\/api\/demo$/, () => getTeam(seedDemo(db))],

  ['GET', /^\/api\/teams\/([\w-]+)$/, ([id]) => getTeam(id)],

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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 40 * 1024 * 1024) fail(413, '요청이 너무 큽니다.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'JSON 형식이 아닙니다.'); }
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
