// 로컬(server.js)과 Vercel(api/index.js)이 함께 쓰는 API 핸들러.
// 입출력은 Web 표준 Request/Response — 서명 검증을 위해 원본 바이트를 그대로 읽을 수 있다.
import { randomUUID } from 'node:crypto';
import { init, get, all, run, newKey } from './db.js';
import { computeScores } from './score.js';
import { fetchGitHub, classify, detectAI, needsReview, AXES } from './collect.js';
import { seedDemo } from './seed.js';
import { summarize, draftStatement, draftText, compareDraft } from './generate.js';
import { verifySignature, parsePageId, ancestors, pageInfo, userInfo, KIND } from './notion.js';

// Vercel 함수의 요청 본문 한도는 4.5MB. 첨부는 여유를 두고 3MB까지.
const MAX_FILE = 3 * 1024 * 1024;
export const MAX_FILE_MB = 3;
const BASIS = ['직접 관찰', '함께 수행', '산출물 확인', '관찰 못 함'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const toolsOf = (repo, notionPage) => JSON.stringify([repo && 'GitHub', notionPage && 'Notion', '수동 기록'].filter(Boolean));
const isClosed = t => !!t.closed_at || Date.now() > new Date(`${t.deadline}T23:59:59+09:00`).getTime();

const text = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim()) fail(400, `${name}을(를) 입력해 주세요.`);
  if (v.length > max) fail(400, `${name}이(가) 너무 깁니다.`);
  return v.trim();
};
const optText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function validateWeights(weights) {
  if (!Array.isArray(weights) || weights.length !== AXES.length) fail(400, 'MRL 3축 가중치를 모두 입력해 주세요.');
  if (weights.some(w => !Number.isInteger(w) || w < 0 || w > 100)) fail(400, '가중치는 0~100 정수입니다.');
  if (weights.reduce((a, b) => a + b, 0) !== 100) fail(400, '3축 가중치 합계는 100%여야 합니다.');
}

// 초대 링크 키로 역할 확인: 교수 키 → professor, 팀원 키 → student(본인)
async function authorize(ctx, teamId) {
  const t = await get('SELECT * FROM teams WHERE id = ?', teamId) || fail(404, '팀을 찾을 수 없습니다.');
  if (ctx.key && ctx.key === t.prof_key) return { role: 'professor', t };
  const m = ctx.key && await get('SELECT * FROM members WHERE team_id = ? AND key = ?', teamId, ctx.key);
  if (m) return { role: 'student', t, me: m };
  fail(403, '이 팀에 접근할 권한이 없습니다. 초대 링크로 다시 들어와 주세요.');
}
const profOnly = a => (a.role === 'professor' ? a : fail(403, '교수만 할 수 있습니다.'));
const studentOnly = a => (a.role === 'student' ? a : fail(403, '팀원(학생)만 할 수 있습니다.'));

// 역할별로 보이는 팀 정보
async function teamView(teamId, a) {
  const t = await get('SELECT * FROM teams WHERE id = ?', teamId);
  const prof = a.role === 'professor';
  const members = (await all('SELECT * FROM members WHERE team_id = ? ORDER BY id', teamId))
    .map(({ key, ...m }) => (prof ? { ...m, key } : { ...m }));
  const rows = (await all('SELECT id, member_id, text, created_at, ai_draft, draft_checked, draft_diff FROM statements WHERE team_id = ?', teamId))
    .filter(s => prof || s.member_id === a.me.id);
  const statements = [];
  for (const s of rows) {
    statements.push({ ...s, draft_diff: s.draft_diff ? JSON.parse(s.draft_diff) : null, files: await all('SELECT id, name, mime FROM files WHERE statement_id = ?', s.id) });
  }
  const parse = r => r && ({ ...r, sentences: JSON.parse(r.sentences), dropped: JSON.parse(r.dropped) });
  const summaries = (await all('SELECT * FROM summaries WHERE team_id = ?', teamId)).filter(s => prof || s.member_id === a.me.id).map(parse);
  const draft = a.me ? parse(await get('SELECT * FROM drafts WHERE team_id = ? AND member_id = ?', teamId, a.me.id)) : null;
  const opinions = (await all('SELECT * FROM opinions WHERE team_id = ? ORDER BY id', teamId)).filter(o => prof || o.member_id === a.me.id);
  const { prof_key, ...rest } = t;
  return {
    ...rest, ...(prof ? { prof_key } : {}),
    role: a.role, me_id: a.me?.id ?? null,
    tools: JSON.parse(t.tools), categories: AXES, weights: JSON.parse(t.weights), closed: isClosed(t),
    members, statements, opinions, summaries, draft,
    accepted_opinions: (await get("SELECT count(*) n FROM opinions WHERE team_id = ? AND status = 'accepted'", teamId)).n,
    record_count: (await get('SELECT count(*) n FROM records WHERE team_id = ?', teamId)).n,
    unmatched: (await get('SELECT count(*) n FROM records WHERE team_id = ? AND member_id IS NULL', teamId)).n,
    ...(prof ? {
      needs_review: (await all('SELECT * FROM records WHERE team_id = ?', teamId)).filter(needsReview).length,
      ai_assisted: (await get('SELECT count(*) n FROM records WHERE team_id = ? AND ai_assisted = 1', teamId)).n,
    } : {}),
    reviewed: a.me ? !!await get('SELECT 1 FROM peer_reviews WHERE team_id = ? AND reviewer_id = ?', teamId, a.me.id) : null,
    review_count: prof ? (await get('SELECT count(DISTINCT reviewer_id) n FROM peer_reviews WHERE team_id = ?', teamId)).n : null,
  };
}

async function createTeam(b) {
  const members = Array.isArray(b.members) ? b.members.filter(m => m?.name?.trim()) : [];
  if (members.length < 2 || members.length > 10) fail(400, '팀원은 2~10명입니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '')) fail(400, '마감일을 입력해 주세요.');
  if (b.repo && !/^[\w.-]+\/[\w.-]+$/.test(b.repo)) fail(400, 'GitHub 저장소는 owner/name 형식입니다.');
  const notionPage = b.notion ? parsePageId(b.notion) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
  const weights = b.weights || [40, 35, 25]; // 균형 프리셋
  validateWeights(weights);
  const id = randomUUID();
  await run('INSERT INTO teams (id, course, name, project, start_date, deadline, repo, notion_page, tools, categories, weights, prof_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, text(b.course, 60, '과목명'), text(b.name, 30, '팀 이름'), text(b.project, 60, '프로젝트명'), b.start_date || null, b.deadline,
    b.repo || null, notionPage, toolsOf(b.repo, notionPage), JSON.stringify(AXES), JSON.stringify(weights), newKey());
  for (const m of members) {
    const email = (m.notion_email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
    await run('INSERT INTO members (team_id, name, role, github, notion_email, key) VALUES (?,?,?,?,?,?)',
      id, text(m.name, 20, '이름'), (m.role || '').slice(0, 30), (m.github || '').trim().replace(/^@/, '') || null, email, newKey());
  }
  return id;
}

const created = async id => ({ team: await teamView(id, { role: 'professor' }), prof_key: (await get('SELECT prof_key FROM teams WHERE id = ?', id)).prof_key });

const routes = [
  ['POST', /^\/api\/teams$/, async (_, b) => created(await createTeam(b))],
  ['POST', /^\/api\/demo$/, async () => created(await seedDemo(newKey))],

  // 초대 링크 해석
  ['GET', /^\/api\/join\/([\w-]+)$/, async ([key]) => {
    const t = await get('SELECT id FROM teams WHERE prof_key = ?', key);
    if (t) return { team_id: t.id, role: 'professor' };
    const m = await get('SELECT team_id, id, name FROM members WHERE key = ?', key) || fail(404, '유효하지 않은 초대 링크입니다.');
    return { team_id: m.team_id, role: 'student', member_id: m.id, name: m.name };
  }],

  ['GET', /^\/api\/teams\/([\w-]+)$/, async ([id], _, ctx) => teamView(id, await authorize(ctx, id))],

  ['DELETE', /^\/api\/teams\/([\w-]+)$/, async ([id], _, ctx) => {
    profOnly(await authorize(ctx, id));
    await run('DELETE FROM teams WHERE id = ?', id);
    return { ok: true };
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/notion$/, async ([id], b, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (isClosed(a.t)) fail(409, '마감된 팀입니다.');
    const page = b.url ? parsePageId(b.url) || fail(400, 'Notion 페이지 링크를 확인해 주세요.') : null;
    await run('UPDATE teams SET notion_page = ?, tools = ? WHERE id = ?', page, toolsOf(a.t.repo, page), id);
    return teamView(id, a);
  }],

  ['PUT', /^\/api\/teams\/([\w-]+)\/members\/(\d+)\/notion$/, async ([id, mid], b, ctx) => {
    const a = await authorize(ctx, id);
    if (a.role === 'student' && a.me.id !== Number(mid)) fail(403, '본인 이메일만 수정할 수 있습니다.');
    const email = String(b.email || '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail(400, 'Notion 이메일 형식을 확인해 주세요.');
    await run('UPDATE members SET notion_email = ? WHERE id = ? AND team_id = ?', email, mid, id);
    if (email) await run("UPDATE records SET member_id = ? WHERE team_id = ? AND member_id IS NULL AND tool = 'Notion' AND lower(login) LIKE ?", mid, id, `%<${email}>`);
    return teamView(id, a);
  }],

  // 가중치는 교수만 설정
  ['PUT', /^\/api\/teams\/([\w-]+)\/weights$/, async ([id], b, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준은 변경할 수 없습니다.');
    validateWeights(b.weights);
    await run('UPDATE teams SET weights = ? WHERE id = ?', JSON.stringify(b.weights), id);
    await run('UPDATE members SET confirmed_at = NULL WHERE team_id = ?', id); // 기준이 바뀌면 학생 재확인
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/confirm$/, async ([id], _, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    if (a.t.locked_at) fail(409, '이미 잠겼습니다.');
    await run("UPDATE members SET confirmed_at = datetime('now') WHERE id = ?", a.me.id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/opinions$/, async ([id], b, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준입니다.');
    await run('INSERT INTO opinions (team_id, member_id, text) VALUES (?,?,?)', id, a.me.id, text(b.text, 500, '의견'));
    return teamView(id, a);
  }],

  ['PATCH', /^\/api\/teams\/([\w-]+)\/opinions\/(\d+)$/, async ([id, oid], b, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (a.t.locked_at) fail(409, '이미 잠긴 기준입니다.');
    if (!['accepted', 'rejected', 'pending'].includes(b.status)) fail(400, '처리 상태가 올바르지 않습니다.');
    await run('UPDATE opinions SET status = ?, reply = ? WHERE id = ? AND team_id = ?', b.status, optText(b.reply, 300), oid, id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/lock$/, async ([id], _, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (a.t.locked_at) fail(409, '이미 잠겼습니다.');
    const ms = await all('SELECT * FROM members WHERE team_id = ?', id);
    if (ms.some(m => !m.confirmed_at)) fail(409, '팀원 전원이 가중치를 확인해야 잠글 수 있습니다.');
    await run("UPDATE teams SET locked_at = datetime('now') WHERE id = ?", id);
    return teamView(id, a);
  }],

  // 시연용: 마감일 전이라도 지금 마감 처리
  ['POST', /^\/api\/teams\/([\w-]+)\/close$/, async ([id], _, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 마감할 수 있습니다.');
    await run("UPDATE teams SET closed_at = datetime('now') WHERE id = ?", id);
    return teamView(id, a);
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/collect$/, async ([id], _, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 수집할 수 있습니다.');
    if (!a.t.repo) fail(400, '연결된 GitHub 저장소가 없습니다.');
    const ms = await all('SELECT * FROM members WHERE team_id = ?', id);
    const byLogin = new Map(ms.filter(m => m.github).map(m => [m.github.toLowerCase(), m.id]));
    const known = new Set((await all('SELECT ext_id FROM records WHERE team_id = ?', id)).map(r => r.ext_id));
    let items;
    try { items = (await fetchGitHub(a.t.repo)).filter(it => !known.has(it.ext_id)); } catch (e) { fail(502, e.message); }
    let ai = 0;
    for (let i = 0; i < items.length; i += 80) {
      const chunk = items.slice(i, i + 80);
      const cls = await classify(chunk);
      for (const [j, it] of chunk.entries()) {
        if (cls[j].by === 'ai') ai++;
        const d = detectAI(it);
        await run('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by, rule_type, prompt_version, ai_assisted, ai_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id, byLogin.get((it.login || '').toLowerCase()) ?? null, it.login || null, it.ext_id, it.tool, it.kind, it.title.slice(0, 300),
          (it.body || '').slice(0, 4000), it.url, it.ref, it.date, cls[j].type, cls[j].reason, cls[j].by, cls[j].rule_type ?? null, cls[j].prompt_version ?? null,
          d.ai ? 1 : 0, d.note);
      }
    }
    await run("UPDATE teams SET collected_at = datetime('now') WHERE id = ?", id);
    const t2 = await teamView(id, a);
    return { added: items.length, ai, review: t2.needs_review, team: t2 };
  }],

  // API 연동 전 도구(Google Docs 등)의 작업을 링크로 기록. 학생은 본인 것만.
  ['POST', /^\/api\/teams\/([\w-]+)\/records$/, async ([id], b, ctx) => {
    const a = await authorize(ctx, id);
    if (!a.t.locked_at) fail(409, '착수 기준을 잠근 뒤 기록할 수 있습니다.');
    if (isClosed(a.t) && a.role === 'student') fail(409, '마감된 팀입니다.');
    const memberId = a.role === 'student' ? a.me.id : b.member_id;
    if (!await get('SELECT 1 FROM members WHERE id = ? AND team_id = ?', memberId ?? null, id)) fail(400, '팀원을 선택해 주세요.');
    if (b.url && !/^https?:\/\//.test(b.url)) fail(400, '링크는 http(s)로 시작해야 합니다.');
    const item = { tool: text(b.tool, 20, '도구'), kind: text(b.kind || '문서 작성', 20, '활동 종류'), title: text(b.title, 200, '제목'), body: optText(b.body, 4000) || '' };
    const [c] = Number.isInteger(b.type) && b.type >= 0 && b.type < AXES.length
      ? [{ type: b.type, reason: '작성자가 직접 선택한 축입니다.', by: 'manual' }]
      : await classify([item]);
    // AI 사용은 작성자가 직접 밝힘 (예: "ChatGPT로 문장 다듬기"). 기여율에는 영향 없음
    const aiUse = optText(b.ai_use, 200);
    const auto = detectAI(item);
    await run('INSERT INTO records (team_id, member_id, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by, rule_type, prompt_version, ai_assisted, ai_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, memberId, `manual:${randomUUID()}`, item.tool, item.kind, item.title, item.body, b.url || null, `${item.tool} 링크`,
      new Date().toISOString(), c.type, c.reason, c.by, c.rule_type ?? null, c.prompt_version ?? null,
      b.ai_assisted || aiUse || auto.ai ? 1 : 0, aiUse ? `작성자 표시: ${aiUse}` : b.ai_assisted ? '작성자가 AI 사용을 표시' : auto.note);
    return teamView(id, a);
  }],

  // 교수: 언제든 / 학생: 마감 후(동료평가의 '동일 작업' 연결용)
  ['GET', /^\/api\/teams\/([\w-]+)\/records$/, async ([id], _, ctx) => {
    const a = await authorize(ctx, id);
    if (a.role === 'student' && !isClosed(a.t)) fail(403, '학기 중에는 기록을 공개하지 않습니다.');
    return all('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC', id);
  }],

  ['PATCH', /^\/api\/teams\/([\w-]+)\/records\/(\d+)$/, async ([id, rid], b, ctx) => {
    profOnly(await authorize(ctx, id));
    const r = await get('SELECT * FROM records WHERE id = ? AND team_id = ?', rid, id) || fail(404, '기록이 없습니다.');
    if (b.type !== undefined) {
      if (!Number.isInteger(b.type) || b.type < 0 || b.type >= AXES.length) fail(400, '축이 올바르지 않습니다.');
      // 축을 그대로 두고 저장해도 '교수 확인'으로 남겨 확인 필요 목록에서 빠지게 함. 원래 AI 판단 근거는 이어서 보존
      const reason = b.type === r.type ? `교수가 원자료를 확인하고 분류를 유지했습니다. (원래 근거: ${r.reason})` : `교수가 원자료를 확인하고 축을 ${AXES[r.type] ?? '미분류'} → ${AXES[b.type]}(으)로 조정했습니다.`;
      if (r.classified_by !== 'professor' || b.type !== r.type) await run("UPDATE records SET type = ?, reason = ?, classified_by = 'professor' WHERE id = ?", b.type, reason.slice(0, 600), r.id);
    }
    if (b.member_id !== undefined) {
      if (b.member_id !== null && !await get('SELECT 1 FROM members WHERE id = ? AND team_id = ?', b.member_id, id)) fail(400, '팀원이 올바르지 않습니다.');
      await run('UPDATE records SET member_id = ? WHERE id = ?', b.member_id, r.id);
    }
    return get('SELECT * FROM records WHERE id = ?', r.id);
  }],

  // 리포트 (교수 전용, 마감 후). 동료평가는 수치와 분리해 함께 전달
  ['GET', /^\/api\/teams\/([\w-]+)\/report$/, async ([id], _, ctx) => {
    const a = profOnly(await authorize(ctx, id));
    if (!isClosed(a.t)) fail(403, '학기 중에는 기여도를 산출하지 않습니다. 마감 후 1회 산출합니다.');
    const team = await teamView(id, a);
    const records = await all('SELECT * FROM records WHERE team_id = ? ORDER BY date DESC', id);
    // 익명: 교수 화면에도 응답자 이름 대신 고정 익명 번호만 (계정 연결은 DB에만 남아 소명 시 확인)
    const alias = new Map((await all('SELECT DISTINCT reviewer_id FROM peer_reviews WHERE team_id = ? ORDER BY reviewer_id', id))
      .map((r, i) => [r.reviewer_id, `익명 ${String.fromCharCode(65 + i)}`]));
    const reviews = (await all('SELECT * FROM peer_reviews WHERE team_id = ? ORDER BY target_id, id', id))
      .map(({ reviewer_id, ...r }) => ({ ...r, reviewer: alias.get(reviewer_id) }));
    return { team, scores: computeScores(team.members, records, team.weights), records, reviews };
  }],

  ['POST', /^\/api\/teams\/([\w-]+)\/statements$/, async ([id], b, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    if (!isClosed(a.t)) fail(409, '마감 후 작성할 수 있습니다.');
    if (await get('SELECT 1 FROM statements WHERE team_id = ? AND member_id = ?', id, a.me.id)) fail(409, '자기 기술은 1회만 제출할 수 있습니다.');
    const files = Array.isArray(b.files) ? b.files : [];
    if (files.length > 5) fail(400, '첨부는 5개까지입니다.');
    const decoded = files.map(f => {
      if (!/^(image\/[\w.+-]+|application\/pdf)$/.test(f?.mime || '')) fail(400, '이미지·PDF만 첨부할 수 있습니다.');
      const data = Buffer.from(String(f.data || ''), 'base64');
      if (!data.length || data.length > MAX_FILE) fail(400, `파일은 ${MAX_FILE_MB}MB 이하여야 합니다.`);
      return { name: String(f.name || 'file').slice(0, 100), mime: f.mime, data };
    });
    const body = text(b.text, 1000, '서술');
    // AI 초안을 받았다면: 학생이 기록과 대조했다는 확인이 있어야 제출. 초안과 제출본의 차이를 함께 저장
    const draft = await get('SELECT text FROM drafts WHERE team_id = ? AND member_id = ?', id, a.me.id);
    if (draft && b.checked !== true) fail(400, 'AI 초안의 문장을 내 기록과 대조해 확인했다고 체크해 주세요.');
    const { lastInsertRowid: sid } = await run('INSERT INTO statements (team_id, member_id, text, ai_draft, draft_checked, draft_diff) VALUES (?,?,?,?,?,?)',
      id, a.me.id, body, draft?.text ?? null, draft ? 1 : 0, draft ? JSON.stringify(compareDraft(draft.text, body)) : null);
    for (const f of decoded) await run('INSERT INTO files (statement_id, name, mime, data) VALUES (?,?,?,?)', sid, f.name, f.mime, f.data);
    return teamView(id, a);
  }],

  // 생성형 AI ①: 근거 인용 기여 요약 (마감 후). 학생은 본인 것만, 교수는 팀원 누구나. 다시 만들면 이전 요약·이의는 교체
  ['POST', /^\/api\/teams\/([\w-]+)\/members\/(\d+)\/summary$/, async ([id, mid], _, ctx) => {
    const a = await authorize(ctx, id);
    if (!isClosed(a.t)) fail(409, '요약은 마감 후 만들 수 있습니다.');
    if (a.role === 'student' && a.me.id !== Number(mid)) fail(403, '본인 요약만 만들 수 있습니다.');
    const m = await get('SELECT * FROM members WHERE id = ? AND team_id = ?', mid, id) || fail(404, '팀원을 찾을 수 없습니다.');
    const prev = await get('SELECT sentences FROM summaries WHERE team_id = ? AND member_id = ?', id, m.id);
    if (prev && JSON.parse(prev.sentences).some(x => x.objection)) fail(409, '학생 이의가 남아 있는 요약은 다시 만들 수 없습니다. 이의를 먼저 확인해 주세요.');
    const records = await all('SELECT * FROM records WHERE team_id = ? AND member_id = ? ORDER BY date', id, m.id);
    if (!records.length) fail(409, '연결된 작업 기록이 없어 요약할 수 없습니다. 자기 기술과 동료평가로 확인해 주세요.');
    const g = await summarize(m, records);
    await run('INSERT OR REPLACE INTO summaries (team_id, member_id, sentences, dropped, generated, by, prompt_version) VALUES (?,?,?,?,?,?,?)',
      id, m.id, JSON.stringify(g.kept), JSON.stringify(g.dropped), g.generated, g.by, g.prompt_version);
    return teamView(id, a);
  }],

  // 학생이 요약 문장에 이의 표시 (AI 결과를 그대로 받아들이지 않도록). 교수 리포트에 함께 보임
  ['POST', /^\/api\/teams\/([\w-]+)\/summary\/objection$/, async ([id], b, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    const row = await get('SELECT * FROM summaries WHERE team_id = ? AND member_id = ?', id, a.me.id) || fail(404, '요약이 없습니다.');
    const sentences = JSON.parse(row.sentences);
    const s = sentences[b.index] || fail(400, '문장을 찾을 수 없습니다.');
    const note = optText(b.text, 300);
    if (note) Object.assign(s, { objection: note, objected_at: new Date().toISOString() }); else { delete s.objection; delete s.objected_at; }
    await run('UPDATE summaries SET sentences = ? WHERE id = ?', JSON.stringify(sentences), row.id);
    return teamView(id, a);
  }],

  // 생성형 AI ②: 자기 기술 초안 (학생 본인, 마감 후·제출 전). 초안은 서버에 보관해 제출본과 비교
  ['POST', /^\/api\/teams\/([\w-]+)\/draft$/, async ([id], _, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    if (!isClosed(a.t)) fail(409, '마감 후 만들 수 있습니다.');
    if (await get('SELECT 1 FROM statements WHERE team_id = ? AND member_id = ?', id, a.me.id)) fail(409, '이미 자기 기술을 제출했습니다.');
    const records = await all('SELECT * FROM records WHERE team_id = ? AND member_id = ? ORDER BY date', id, a.me.id);
    if (!records.length) fail(409, '연결된 작업 기록이 없어 초안을 만들 수 없습니다. 직접 작성해 주세요.');
    const g = await draftStatement(a.me, records);
    if (!g.kept.length) fail(422, '근거 확인을 통과한 문장이 없어 초안을 만들지 못했습니다. 직접 작성해 주세요.');
    await run('INSERT OR REPLACE INTO drafts (team_id, member_id, text, sentences, dropped, generated, by, prompt_version) VALUES (?,?,?,?,?,?,?,?)',
      id, a.me.id, draftText(g.kept, records), JSON.stringify(g.kept), JSON.stringify(g.dropped), g.generated, g.by, g.prompt_version);
    return teamView(id, a);
  }],

  // 익명 동료평가 (마감 후 1회, 본인 제외 팀원 전원)
  ['POST', /^\/api\/teams\/([\w-]+)\/peer-reviews$/, async ([id], b, ctx) => {
    const a = studentOnly(await authorize(ctx, id));
    if (!isClosed(a.t)) fail(409, '동료평가는 마감 후에 열립니다.');
    if (await get('SELECT 1 FROM peer_reviews WHERE team_id = ? AND reviewer_id = ?', id, a.me.id)) fail(409, '동료평가는 1회만 제출할 수 있습니다.');
    const targets = (await all('SELECT id FROM members WHERE team_id = ? AND id != ?', id, a.me.id)).map(m => m.id);
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length !== targets.length || !targets.every(t => items.some(i => i.target_id === t))) fail(400, '모든 팀원에 대해 작성해 주세요.');
    const rows = [];
    for (const i of items) {
      if (!Number.isInteger(i.axis) || i.axis < 0 || i.axis >= AXES.length) fail(400, '기여 축을 선택해 주세요.');
      if (!BASIS.includes(i.basis)) fail(400, '근거를 선택해 주세요.');
      const unseen = i.basis === '관찰 못 함';
      const did = unseen ? optText(i.did, 800) : text(i.did, 800, '무엇을 했는지');
      // 공동 작업은 다른 팀원 계정에 기록됐을 수 있어 팀 전체 기록에서 연결 허용
      const rec = i.record_id ? await get('SELECT id FROM records WHERE id = ? AND team_id = ?', i.record_id, id) : null;
      if (i.record_id && !rec) fail(400, '연결한 기록을 찾을 수 없습니다.');
      rows.push([i.target_id, '전체 기간', i.axis, did, null, i.basis, null, rec?.id ?? null, null]);
    }
    for (const r of rows) await run('INSERT INTO peer_reviews (team_id, reviewer_id, target_id, period, axis, did, impact, basis, link, record_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, a.me.id, ...r);
    return teamView(id, a);
  }],
];

// Notion 웹훅 이벤트 → 팀 루트 페이지 하위인지 확인 → 편집자별 기록
// 같은 페이지·같은 편집자·같은 날(KST)·같은 종류는 1건으로 합침 (반복 편집 부풀리기 완화)
export async function handleNotionEvent(ev) {
  if (!KIND[ev.type]) return;
  const pageId = ev.entity?.type === 'page' ? ev.entity.id : ev.type === 'comment.created' ? ev.data?.page_id : null;
  if (!pageId) return;
  const teams = (await all('SELECT * FROM teams WHERE notion_page IS NOT NULL AND locked_at IS NOT NULL')).filter(t => !isClosed(t));
  if (!teams.length) return;
  if (!process.env.NOTION_TOKEN) return console.warn('[Notion] NOTION_TOKEN이 없어 이벤트를 처리하지 못했습니다.');
  const chain = await ancestors(pageId);
  const team = teams.find(t => chain.includes(t.notion_page));
  if (!team) return;
  const authors = (ev.authors || []).filter(a => a.type === 'person');
  if (!authors.length) return;
  const { title, url, createdBy } = await pageInfo(pageId);
  const members = await all('SELECT * FROM members WHERE team_id = ?', team.id);
  const day = new Date(new Date(ev.timestamp).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  for (const a of authors) {
    const kind = KIND[ev.type];
    // 회의록 등 관리 문서는 제목으로 '이끌기', 그 외에는 본인 페이지면 '만들기' · 남의 페이지면 '다듬기'
    const lead = /회의록|회의|일정|계획|마일스톤|태스크|담당/.test(title);
    const c = kind === '속성 편집' ? { type: 2, reason: '일정·담당·상태 등 속성 변경을 이끌기에 연결했습니다.' }
      : kind === '댓글' ? { type: 1, reason: '문서에 남긴 검토 댓글을 다듬기에 연결했습니다.' }
      : lead ? { type: 2, reason: '회의·일정 등 관리 문서 작성이라 이끌기에 연결했습니다.' }
      : kind === '페이지 생성' || createdBy === a.id ? { type: 0, reason: '본인이 만든 페이지의 내용을 작성해 만들기에 연결했습니다.' }
      : { type: 1, reason: '다른 팀원이 만든 페이지를 편집해 다듬기에 연결했습니다.' };
    const u = await userInfo(a.id);
    const member = u.email && members.find(m => m.notion_email === u.email);
    const blocks = ev.data?.updated_blocks?.length;
    await run('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      team.id, member?.id ?? null, `${u.name} <${u.email || a.id}>`, `notion:${ev.type}:${pageId}:${a.id}:${day}`, 'Notion', kind, title,
      blocks ? `블록 ${blocks}개 변경` : '', url, `Notion · ${day}`, ev.timestamp, c.type, c.reason, 'rule');
  }
}

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (status, body) => Response.json(body, { status, headers: SECURITY });

// 모든 /api/* 요청의 진입점
export async function handle(request) {
  const url = new URL(request.url);
  try {
    await init();
    const ctx = { key: request.headers.get('x-key') || url.searchParams.get('k') || '' };

    const file = url.pathname.match(/^\/api\/files\/(\d+)$/);
    if (file && request.method === 'GET') {
      const f = await get('SELECT f.*, s.team_id, s.member_id FROM files f JOIN statements s ON s.id = f.statement_id WHERE f.id = ?', file[1]) || fail(404, '파일이 없습니다.');
      const a = await authorize(ctx, f.team_id);
      if (a.role === 'student' && a.me.id !== f.member_id) fail(403, '본인 첨부만 열람할 수 있습니다.');
      return new Response(Buffer.from(f.data), { headers: {
        ...SECURITY, 'Content-Type': f.mime,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      } });
    }

    if (url.pathname === '/api/webhooks/notion' && request.method === 'POST') {
      const raw = Buffer.from(await request.arrayBuffer()); // 서명은 원본 바이트로 검증해야 한다
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { fail(400, 'JSON 형식이 아닙니다.'); }
      // 구독 생성 직후 1회: 이 토큰을 Notion 화면에 붙여넣고, NOTION_WEBHOOK_SECRET 환경변수로 등록
      if (ev.verification_token && !ev.type) {
        console.log(`[Notion] verification_token: ${ev.verification_token}`);
        return json(200, { ok: true });
      }
      if (!verifySignature(raw, request.headers.get('x-notion-signature'), process.env.NOTION_WEBHOOK_SECRET)) fail(401, '서명이 올바르지 않습니다.');
      // 서버리스에서는 응답 후 실행이 보장되지 않아 끝까지 처리하고 응답한다 (Notion 재시도 대비)
      await handleNotionEvent(ev).catch(e => console.error('[Notion] 이벤트 처리 실패:', e.message));
      return json(200, { ok: true });
    }

    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re);
      if (m && method === request.method) {
        let body = {};
        if (request.method !== 'GET' && request.method !== 'DELETE') {
          const raw = await request.text();
          if (raw) { try { body = JSON.parse(raw); } catch { fail(400, 'JSON 형식이 아닙니다.'); } }
        }
        return json(200, await handler(m.slice(1), body, ctx));
      }
    }
    fail(404, '없는 API입니다.');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return json(e.status || 500, { error: e instanceof HttpError ? e.message : '서버 오류가 발생했습니다.' });
  }
}
