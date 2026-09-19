import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { computeScores } from './score.js';
import { fetchGitHub, classify, AXES } from './collect.js';
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
);
CREATE TABLE IF NOT EXISTS opinions (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', reply TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS peer_reviews (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period TEXT NOT NULL, axis INTEGER NOT NULL, did TEXT, impact TEXT, basis TEXT NOT NULL,
  link TEXT, record_id INTEGER REFERENCES records(id) ON DELETE SET NULL, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(team_id, reviewer_id, target_id)
);`);

// 기존 DB에 새 컬럼 추가
for (const [table, col] of [['teams', 'notion_page'], ['teams', 'prof_key'], ['members', 'notion_email'], ['members', 'key'], ['members', 'consented_at']]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
}
for (const t of db.prepare('SELECT id FROM teams WHERE prof_key IS NULL').all()) db.prepare('UPDATE teams SET prof_key = ? WHERE id = ?').run(newKey(), t.id);
for (const m of db.prepare('SELECT id FROM members WHERE key IS NULL').all()) db.prepare('UPDATE members SET key = ? WHERE id = ?').run(newKey(), m.id);

const MAX_FILE = 5 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const BASIS = ['직접 관찰', '함께 수행', '산출물 확인', '전해 들음', '관찰 못 함'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function newKey() { return randomBytes(18).toString('base64url'); }
const toolsOf = (repo, notionPage) => JSON.stringify([repo && 'GitHub', notionPage && 'Notion', '수동 기록'].filter(Boolean));
const isClosed = t => !!t.closed_at || Date.now() > new Date(`${t.deadline}T23:59:59+09:00`).getTime();

const text = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim()) fail(400, `${name}을(를) 입력해 주세요.`);
  if (v.length > max) fail(400, `${name}이(가) 너무 깁니다.`);
  return v.trim();
};
const optText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function validateWeights(weights) {
  if (!Array.isArray(weights) || weights.length !== AXES.length) fail(400, '4축 가중치를 모두 입력해 주세요.');
  if (weights.some(w => !Number.isInteger(w) || w < 0 || w > 100)) fail(400, '가중치는 0~100 정수입니다.');
  if (weights.reduce((a, b) => a + b, 0) !== 100) fail(400, '4축 가중치 합계는 100%여야 합니다.');
}

// 초대 링크 키로 역할 확인: 교수 키 → professor, 팀원 키 → student(본인)
function authorize(req, teamId) {
  const key = req.headers['x-key'] || new URL(req.url, 'http://x').searchParams.get('k');
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) || fail(404, '팀을 찾을 수 없습니다.');
  if (key && key === t.prof_key) return { role: 'professor', t };
  const m = key && db.prepare('SELECT * FROM members WHERE team_id = ? AND key = ?').get(teamId, key);
  if (m) return { role: 'student', t, me: m };
  fail(403, '이 팀에 접근할 권한이 없습니다. 초대 링크로 다시 들어와 주세요.');
}
const profOnly = a => (a.role === 'professor' ? a : fail(403, '교수만 할 수 있습니다.'));
const studentOnly = a => (a.role === 'student' ? a : fail(403, '팀원(학생)만 할 수 있습니다.'));
const consented = a => (a.me.consented_at ? a : fail(403, '개인정보 수집·이용 동의 후 이용할 수 있습니다.'));

// 역할별로 보이는 팀 정보
function teamView(teamId, a) {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  const prof = a.role === 'professor';
  const members = db.prepare('SELECT * FROM members WHERE team_id = ? ORDER BY id').all(teamId)
    .map(({ key, ...m }) => (prof ? { ...m, key } : m));
  const statements = db.prepare('SELECT id, member_id, text, created_at FROM statements WHERE team_id = ?').all(teamId)
    .filter(s => prof || s.member_id === a.me.id)
    .map(s => ({ ...s, files: db.prepare('SELECT id, name, mime FROM files WHERE statement_id = ?').all(s.id) }));
  const opinions = db.prepare('SELECT * FROM opinions WHERE team_id = ? ORDER BY id').all(teamId).filter(o => prof || o.member_id === a.me.id);
  const { prof_key, ...rest } = t;
  return {
    ...rest, ...(prof ? { prof_key } : {}),
    role: a.role, me_id: a.me?.id ?? null,
    tools: JSON.parse(t.tools), categories: AXES, weights: JSON.parse(t.weights), closed: isClosed(t),
    members, statements, opinions,
    accepted_opinions: db.prepare("SELECT count(*) n FROM opinions WHERE team_id = ? AND status = 'accepted'").get(teamId).n,
    record_count: db.prepare('SELECT count(*) n FROM records WHERE team_id = ?').get(teamId).n,
    unmatched: db.prepare('SELECT count(*) n FROM records WHERE team_id = ? AND member_id IS NULL').get(teamId).n,
    reviewed: a.me ? !!db.prepare('SELECT 1 FROM peer_reviews WHERE team_id = ? AND reviewer_id = ?').get(teamId, a.me.id) : null,
    review_count: prof ? db.prepare('SELECT count(DISTINCT reviewer_id) n FROM peer_reviews WHERE team_id = ?').get(teamId).n : null,
  };
}

function createTeam(b) {
  const members = Array.isArray(b.members) ? b.members.filter(m => m?.name?.trim()) : [];
  if (members.length < 2 || members.length > 10) fail(400, '팀원은 2~10명입니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '')) fail(400, '마감일을 입력해 주세요.');
  if (b.repo && !/^[\w.-]+\/[\w.-]+$/.test(b.repo)) fail(400, 'GitHub 저장소는 owner/name 형식입니다.');
  const notionPage = b.notion ? parsePageId(b.notion) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
  const weights = b.weights || [30, 25, 25, 20];
  validateWeights(weights);
  const id = randomUUID();
  db.prepare('INSERT INTO teams (id, course, name, project, start_date, deadline, repo, notion_page, tools, categories, weights, prof_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, text(b.course, 60, '과목명'), text(b.name, 30, '팀 이름'), text(b.project, 60, '프로젝트명'), b.start_date || null, b.deadline,
      b.repo || null, notionPage, toolsOf(b.repo, notionPage), JSON.stringify(AXES), JSON.stringify(weights), newKey());
  const ins = db.prepare('INSERT INTO members (team_id, name, role, github, notion_email, key) VALUES (?,?,?,?,?,?)');
  for (const m of members) {
    const email = (m.notion_email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
    ins.run(id, text(m.name, 20, '이름'), (m.role || '').slice(0, 30), (m.github || '').trim().replace(/^@/, '') || null, email, newKey());
  }
  return id;
}

const created = id => {
  const { prof_key } = db.prepare('SELECT prof_key FROM teams WHERE id = ?').get(id);
  return { team: teamView(id, { role: 'professor' }), prof_key };
};

const routes = [
  ['POST', /^\/api\/teams$/, (_, b) => created(createTeam(b))],
  ['POST', /^\/api\/demo$/, () => created(seedDemo(db, newKey))],

  // 초대 링크 해석
  ['GET', /^\/api\/join\/([\w-]+)$/, ([key]) => {
    const t = db.prepare('SELECT id FROM teams WHERE prof_key = ?').get(key);
    if (t) return { team_id: t.id, role: 'professor' };
    const m = db.prepare('SELECT team_id, id, name FROM members WHERE key = ?').get(key) || fail(404, '유효하지 않은 초대 링크입니다.');
    return { team_id: m.team_id, role: 'student', member_id: m.id, name: m.name };
  }],

  ['GET', /^\/api\/teams\/([\w-]+)$/, ([id], _, req) => teamView(id, authorize(req, id))],

  ['DELETE', /^\/api\/teams\/([\w-]+)$/, ([id], _, req) => {
    profOnly(authorize(req, id));
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    return { ok: true };
  }],

  // 작업 1: 개인정보 수집·이용 동의 (본인)
  ['POST', /^\/api\/teams\/([\w-]+)\/consent$/, ([id], b, req) => {
    const a = studentOnly(authorize(req, id));
    if (b.agree !== true) fail(400, '동의 항목을 확인해 주세요.');
    db.prepare("UPDATE members SET consented_at = coalesce(consented_at, datetime('now')) WHERE id = ?").run(a.me.id);
    return teamView(id, authorize(req, id));
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/notion$/, ([id], b, req) => {
    const a = profOnly(authorize(req, id));
    if (isClosed(a.t)) fail(409, '마감된 팀입니다.');
    const page = b.url ? parsePageId(b.url) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
    db.prepare('UPDATE teams SET notion_page = ?, tools = ? WHERE id = ?').run(page, toolsOf(a.t.repo, page), id);
    return teamView(id, a);
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/members\/(\d+)\/notion$/, ([id, mid], b, req) => {
    const a = authorize(req, id);
    if (a.role === 'student' && a.me.id !== Number(mid)) fail(403, '본인 이메일만 수정할 수 있습니다.');
    const email = String(b.email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
    db.prepare('UPDATE members SET notion_email = ? WHERE id = ? AND team_id = ?').run(email, mid, id);
    if (email) db.prepare("UPDATE records SET member_id = ? WHERE team_id = ? AND member_id IS NULL AND tool = 'Notion' AND lower(login) LIKE ?").run(mid, id, `%<${email}>`);
    return teamView(id, a);
  }],

  // 작업 2: 가중치는 교수만 설정
  ['PUT', /^\/api\/teams\/([\w-]+)\/weights$/, ([id], b, req) => {
    const a = profOnly(authorize(req, id));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준은 변경할 수 없습니다.');
    validateWeights(b.weights);
    db.prepare('UPDATE teams SET weights = ? WHERE id = ?').run(JSON.stringify(b.weights), id);
    db.prepare('UPDATE members SET confirmed_at = NULL WHERE team_id = ?').run(id); // 기준이 바뀌면 학생 재확인
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/confirm$/, ([id], _, req) => {
    const a = consented(studentOnly(authorize(req, id)));
    if (a.t.locked_at) fail(409, '이미 잠겼습니다.');
    db.prepare("UPDATE members SET confirmed_at = datetime('now') WHERE id = ?").run(a.me.id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/opinions$/, ([id], b, req) => {
    const a = consented(studentOnly(authorize(req, id)));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준입니다.');
    db.prepare('INSERT INTO opinions (team_id, member_id, text) VALUES (?,?,?)').run(id, a.me.id, text(b.text, 500, '의견'));
    return teamView(id, a);
  }],

  ['PATCH', /^\/api\/teams\/([\w-]+)\/opinions\/(\d+)$/, ([id, oid], b, req) => {
    const a = profOnly(authorize(req, id));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준입니다.');
    if (!['accepted', 'rejected', 'pending'].includes(b.status)) fail(400, '처리 상태가 올바르지 않습니다.');
    db.prepare('UPDATE opinions SET status = ?, reply = ? WHERE id = ? AND team_id = ?').run(b.status, optText(b.reply, 300), oid, id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/lock$/, ([id], _, req) => {
    const a = profOnly(authorize(req, id));
    if (a.t.locked_at) fail(409, '이미 잠겼습니다.');
    const ms = db.prepare('SELECT * FROM members WHERE team_id = ?').all(id);
    if (ms.some(m => !m.consented_at)) fail(409, '팀원 전원이 개인정보 수집·이용에 동의해야 잠글 수 있습니다.');
    if (ms.some(m => !m.confirmed_at)) fail(409, '팀원 전원이 가중치를 확인해야 잠글 수 있습니다.');
    db.prepare("UPDATE teams SET locked_at = datetime('now') WHERE id = ?").run(id);
    return teamView(id, a);
  }],

  // 시연용: 마감일 전이라도 지금 마감 처리
  ['POST', /^\/api\/teams\/([\w-]+)\/close$/, ([id], _, req) => {
    const a = profOnly(authorize(req, id));
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 마감할 수 있습니다.');
    db.prepare("UPDATE teams SET closed_at = datetime('now') WHERE id = ?").run(id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/collect$/, async ([id], _, req) => {
    const a = profOnly(authorize(req, id));
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 수집할 수 있습니다.');
    if (!a.t.repo) fail(400, '연결된 GitHub 저장소가 없습니다.');
    const ms = db.prepare('SELECT * FROM members WHERE team_id = ?').all(id);
    const byLogin = new Map(ms.filter(m => m.github).map(m => [m.github.toLowerCase(), m.id]));
    const known = new Set(db.prepare('SELECT ext_id FROM records WHERE team_id = ?').all(id).map(r => r.ext_id));
    let items;
    try { items = (await fetchGitHub(a.t.repo)).filter(it => !known.has(it.ext_id)); } catch (e) { fail(502, e.message); }
    const ins = db.prepare('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let ai = 0;
    for (let i = 0; i < items.length; i += 80) {
      const chunk = items.slice(i, i + 80);
      const cls = await classify(chunk);
      chunk.forEach((it, j) => {
        if (cls[j].by === 'ai') ai++;
        ins.run(id, byLogin.get((it.login || '').toLowerCase()) ?? null, it.login || null, it.ext_id, it.tool, it.kind, it.title.slice(0, 300),
          (it.body || '').slice(0, 4000), it.url, it.ref, it.date, cls[j].type, cls[j].reason, cls[j].by);
      });
    }
    db.prepare("UPDATE teams SET collected_at = datetime('now') WHERE id = ?").run(id);
    return { added: items.length, ai, team: teamView(id, a) };
  }],

  // API 연동 전 도구(Google Docs 등)의 작업을 링크로 기록. 학생은 본인 것만.
  ['POST', /^\/api\/teams\/([\w-]+)\/records$/, async ([id], b, req) => {
    const a = authorize(req, id);
    if (a.role === 'student') consented(a);
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 기록할 수 있습니다.');
    if (isClosed(a.t) && a.role === 'student') fail(409, '마감된 팀입니다.');
    const memberId = a.role === 'student' ? a.me.id : b.member_id;
    if (!db.prepare('SELECT 1 FROM members WHERE id = ? AND team_id = ?').get(memberId, id)) fail(400, '팀원을 선택해 주세요.');
    if (b.url && !/^https?:\/\//.test(b.url)) fail(400, '링크는 http(s)로 시작해야 합니다.');
    const item = { tool: text(b.tool, 20, '도구'), kind: text(b.kind || '문서 작성', 20, '활동 종류'), title: text(b.title, 200, '제목'), body: optText(b.body, 4000) || '' };
    const [c] = Number.isInteger(b.type) && b.type >= 0 && b.type < AXES.length
      ? [{ type: b.type, reason: '작성자가 직접 선택한 축입니다.', by: 'manual' }]
      : await classify([item]);
    db.prepare('INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, memberId, `manual:${randomUUID()}`, item.tool, item.kind, item.title, item.body, b.url || null, `${item.tool} 링크`,
        new Date().toISOString(), c.type, c.reason, c.by);
    return teamView(id, a);
  }],

  // 교수: 언제든 / 학생: 마감 후(동료평가의 '동일 작업' 연결용)
  ['GET', /^\/api\/teams\/([\w-]+)\/records$/, ([id], _, req) => {
    const a = authorize(req, id);
    if (a.role === 'student' && !isClosed(a.t)) fail(403, '학기 중에는 기록을 공개하지 않습니다.');
    return db.prepare('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC').all(id);
  }],

  ['PATCH', /^\/api\/teams\/([\w-]+)\/records\/(\d+)$/, ([id, rid], b, req) => {
    profOnly(authorize(req, id));
    const r = db.prepare('SELECT * FROM records WHERE id = ? AND team_id = ?').get(rid, id) || fail(404, '기록이 없습니다.');
    if (b.type !== undefined) {
      if (!Number.isInteger(b.type) || b.type < 0 || b.type >= AXES.length) fail(400, '축이 올바르지 않습니다.');
      db.prepare("UPDATE records SET type = ?, reason = ?, classified_by = 'professor' WHERE id = ?").run(b.type, '교수가 원자료를 확인하고 축을 조정했습니다.', r.id);
    }
    if (b.member_id !== undefined) {
      if (b.member_id !== null && !db.prepare('SELECT 1 FROM members WHERE id = ? AND team_id = ?').get(b.member_id, id)) fail(400, '팀원이 올바르지 않습니다.');
      db.prepare('UPDATE records SET member_id = ? WHERE id = ?').run(b.member_id, r.id);
    }
    return db.prepare('SELECT * FROM records WHERE id = ?').get(r.id);
  }],

  // 작업 4: 리포트 (교수 전용, 마감 후). 동료평가는 수치와 분리해 함께 전달
  ['GET', /^\/api\/teams\/([\w-]+)\/report$/, ([id], _, req) => {
    const a = profOnly(authorize(req, id));
    if (!isClosed(a.t)) fail(403, '학기 중에는 기여도를 산출하지 않습니다. 마감 후 1회 산출합니다.');
    const team = teamView(id, a);
    const records = db.prepare('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC').all(id);
    const reviews = db.prepare('SELECT * FROM peer_reviews WHERE team_id = ? ORDER BY target_id, id').all(id);
    return { team, scores: computeScores(team.members, records, team.weights), records, reviews };
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/statements$/, ([id], b, req) => {
    const a = consented(studentOnly(authorize(req, id)));
    if (!isClosed(a.t)) fail(409, '마감 후 작성할 수 있습니다.');
    if (db.prepare('SELECT 1 FROM statements WHERE team_id = ? AND member_id = ?').get(id, a.me.id)) fail(409, '자기 기술은 1회만 제출할 수 있습니다.');
    const files = Array.isArray(b.files) ? b.files : [];
    if (files.length > 5) fail(400, '첨부는 5개까지입니다.');
    const decoded = files.map(f => {
      if (!/^(image\/[\w.+-]+|application\/pdf)$/.test(f?.mime || '')) fail(400, '이미지·PDF만 첨부할 수 있습니다.');
      const data = Buffer.from(String(f.data || ''), 'base64');
      if (!data.length || data.length > MAX_FILE) fail(400, '파일은 5MB 이하여야 합니다.');
      return { name: String(f.name || 'file').slice(0, 100), mime: f.mime, data };
    });
    const { lastInsertRowid: sid } = db.prepare('INSERT INTO statements (team_id, member_id, text) VALUES (?,?,?)').run(id, a.me.id, text(b.text, 1000, '서술'));
    for (const f of decoded) db.prepare('INSERT INTO files (statement_id, name, mime, data) VALUES (?,?,?,?)').run(sid, f.name, f.mime, f.data);
    return teamView(id, a);
  }],

  // 작업 3: 익명 동료평가 (마감 후 1회, 본인 제외 팀원 전원)
  ['POST', /^\/api\/teams\/([\w-]+)\/peer-reviews$/, ([id], b, req) => {
    const a = consented(studentOnly(authorize(req, id)));
    if (!isClosed(a.t)) fail(409, '동료평가는 마감 후에 열립니다.');
    if (db.prepare('SELECT 1 FROM peer_reviews WHERE team_id = ? AND reviewer_id = ?').get(id, a.me.id)) fail(409, '동료평가는 1회만 제출할 수 있습니다.');
    const targets = db.prepare('SELECT id FROM members WHERE team_id = ? AND id != ?').all(id, a.me.id).map(m => m.id);
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length !== targets.length || !targets.every(t => items.some(i => i.target_id === t))) fail(400, '모든 팀원에 대해 작성해 주세요.');
    const rows = items.map(i => {
      if (!Number.isInteger(i.axis) || i.axis < 0 || i.axis >= AXES.length) fail(400, '기여 유형(4축)을 선택해 주세요.');
      if (!BASIS.includes(i.basis)) fail(400, '근거를 선택해 주세요.');
      const unseen = i.basis === '관찰 못 함';
      const did = unseen ? optText(i.did, 800) : text(i.did, 800, '구체적으로 한 일');
      if (i.link && !/^https?:\/\//.test(i.link)) fail(400, '연결 자료 링크는 http(s)로 시작해야 합니다.');
      // 공동 작업은 다른 팀원 계정에 기록됐을 수 있어 팀 전체 기록에서 연결 허용
      const rec = i.record_id ? db.prepare('SELECT id FROM records WHERE id = ? AND team_id = ?').get(i.record_id, id) : null;
      if (i.record_id && !rec) fail(400, '연결한 기록을 찾을 수 없습니다.');
      return [i.target_id, text(i.period || '전체 기간', 40, '평가 기간'), i.axis, did, optText(i.impact, 400), i.basis, optText(i.link, 300), rec?.id ?? null, optText(i.note, 500)];
    });
    const ins = db.prepare('INSERT INTO peer_reviews (team_id, reviewer_id, target_id, period, axis, did, impact, basis, link, record_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const r of rows) ins.run(id, a.me.id, ...r);
    return teamView(id, a);
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
// 같은 페이지·같은 편집자·같은 날(KST)·같은 종류는 1건으로 합침 (반복 편집 부풀리기 완화)
async function handleNotionEvent(ev) {
  if (!KIND[ev.type]) return;
  const pageId = ev.entity?.type === 'page' ? ev.entity.id : ev.type === 'comment.created' ? ev.data?.page_id : null;
  if (!pageId) return;
  const teams = db.prepare('SELECT * FROM teams WHERE notion_page IS NOT NULL AND locked_at IS NOT NULL').all().filter(t => !isClosed(t));
  if (!teams.length) return;
  if (!process.env.NOTION_TOKEN) return console.warn('[Notion] NOTION_TOKEN이 없어 이벤트를 처리하지 못했습니다.');
  const chain = await ancestors(pageId);
  const team = teams.find(t => chain.includes(t.notion_page));
  if (!team) return;
  const authors = (ev.authors || []).filter(a => a.type === 'person');
  if (!authors.length) return;
  const { title, url, createdBy } = await pageInfo(pageId);
  const members = db.prepare('SELECT * FROM members WHERE team_id = ?').all(team.id);
  const day = new Date(new Date(ev.timestamp).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  for (const a of authors) {
    const kind = KIND[ev.type];
    // 문서 편집: 본인이 만든 페이지면 '생성', 남의 페이지면 '개선'
    const c = kind === '문서 편집'
      ? (createdBy === a.id ? { type: 0, reason: '본인이 만든 페이지의 내용을 작성해 산출물 생성에 연결했습니다.' } : { type: 1, reason: '다른 팀원이 만든 페이지를 편집해 산출물 개선에 연결했습니다.' })
      : { 페이지생성: { type: 0, reason: '새 페이지를 만들어 산출물 생성에 연결했습니다.' }, 속성편집: { type: 2, reason: '일정·담당·상태 등 속성 변경을 조율/관리에 연결했습니다.' }, 댓글: { type: 3, reason: '페이지 댓글을 의사소통에 연결했습니다.' } }[kind.replace(/\s/g, '')];
    const u = await userInfo(a.id);
    const member = u.email && members.find(m => m.notion_email === u.email);
    const blocks = ev.data?.updated_blocks?.length;
    db.prepare('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(team.id, member?.id ?? null, `${u.name} <${u.email || a.id}>`, `notion:${ev.type}:${pageId}:${a.id}:${day}`, 'Notion', kind, title,
        blocks ? `블록 ${blocks}개 변경` : '', url, `Notion · ${day}`, ev.timestamp, c.type, c.reason, 'rule');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  try {
    const file = url.pathname.match(/^\/api\/files\/(\d+)$/);
    if (file && req.method === 'GET') {
      const f = db.prepare('SELECT f.*, s.team_id, s.member_id FROM files f JOIN statements s ON s.id = f.statement_id WHERE f.id = ?').get(file[1]) || fail(404, '파일이 없습니다.');
      const a = authorize(req, f.team_id);
      if (a.role === 'student' && a.me.id !== f.member_id) fail(403, '본인 첨부만 열람할 수 있습니다.');
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" });
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
        if (m && method === req.method) return send(200, await handler(m.slice(1), await readBody(req), req));
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
