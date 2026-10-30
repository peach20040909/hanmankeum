// libSQL(Turso) DB 계층. 환경변수가 없으면 로컬 파일로 동작한다.
// node:sqlite의 동기 API를 쓰던 자리를 async get/all/run으로 대체한다.
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';

const url = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH || 'hanmankeum.db'}`;
export const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

export const all = (sql, ...args) => client.execute({ sql, args }).then(r => r.rows);
export const get = (sql, ...args) => all(sql, ...args).then(rows => rows[0]);
export const run = (sql, ...args) => client.execute({ sql, args })
  .then(r => ({ lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid), rowsAffected: r.rowsAffected }));

export const newKey = () => randomBytes(18).toString('base64url');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, name TEXT NOT NULL, project TEXT NOT NULL,
    start_date TEXT, deadline TEXT NOT NULL, repo TEXT, tools TEXT NOT NULL DEFAULT '["GitHub"]',
    categories TEXT NOT NULL, weights TEXT NOT NULL, locked_at TEXT, closed_at TEXT,
    collected_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT, github TEXT, confirmed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL, login TEXT,
    ext_id TEXT NOT NULL, tool TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
    url TEXT, ref TEXT, date TEXT, type INTEGER, reason TEXT, classified_by TEXT,
    UNIQUE(team_id, ext_id))`,
  `CREATE TABLE IF NOT EXISTS statements (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(team_id, member_id))`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY, statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS opinions (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', reply TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS peer_reviews (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    reviewer_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    period TEXT NOT NULL, axis INTEGER NOT NULL, did TEXT, impact TEXT, basis TEXT NOT NULL,
    link TEXT, record_id INTEGER REFERENCES records(id) ON DELETE SET NULL, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(team_id, reviewer_id, target_id))`,
  `CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, sentences TEXT NOT NULL, dropped TEXT NOT NULL,
    generated INTEGER NOT NULL, by TEXT NOT NULL, prompt_version TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, member_id))`,
  `CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, text TEXT NOT NULL, sentences TEXT NOT NULL,
    dropped TEXT NOT NULL, generated INTEGER NOT NULL, by TEXT NOT NULL, prompt_version TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(team_id, member_id))`,
];

// 기존 DB에 뒤늦게 추가된 컬럼
const COLUMNS = [
  ['teams', 'notion_page'], ['teams', 'prof_key'], ['members', 'notion_email'], ['members', 'key'],
  ['records', 'rule_type', 'INTEGER'], ['records', 'prompt_version'], ['records', 'ai_assisted', 'INTEGER NOT NULL DEFAULT 0'], ['records', 'ai_note'],
  ['statements', 'ai_draft'], ['statements', 'draft_checked', 'INTEGER NOT NULL DEFAULT 0'], ['statements', 'draft_diff'],
];

let ready;
// 서버리스에서는 인스턴스마다 한 번만 실행되게 Promise를 재사용한다.
export function init() {
  ready ??= (async () => {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.batch(SCHEMA, 'write');
    for (const [table, col, type = 'TEXT'] of COLUMNS) {
      const cols = await all(`PRAGMA table_info(${table})`);
      if (!cols.some(c => c.name === col)) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
    for (const t of await all('SELECT id FROM teams WHERE prof_key IS NULL')) await run('UPDATE teams SET prof_key = ? WHERE id = ?', newKey(), t.id);
    for (const m of await all('SELECT id FROM members WHERE key IS NULL')) await run('UPDATE members SET key = ? WHERE id = ?', newKey(), m.id);
  })();
  return ready;
}
