import { all, run } from './db.js';
import { askJSON, hasAI, MODEL } from './ai.js';

// 기여를 나누는 기준은 서비스가 정하지 않는다. 교수가 원래 쓰던 평가기준을 입력하면
// LLM이 '협업 기록으로 확인할 수 있는 항목'으로 정리하고, 교수가 고쳐서 확정한다.
// 기준 항목: { name, desc, weight, keywords: [], kinds: [] }
//   keywords·kinds는 교수가 확정한 규칙 → LLM 분류와 엇갈리면 '확인 필요'

// 수집되는 활동 종류 (규칙 매칭에 쓰는 고정 목록)
export const KINDS = ['Commit', 'Pull request', '코드 리뷰', '리뷰 댓글', 'Issue', '페이지 생성', '문서 편집', '남의 문서 편집', '속성 편집', '댓글', '문서 작성'];

// 교수가 기준을 넣기 전 보여주는 예시 (착수 설정에서 교수 기준으로 바꾼다)
export const EXAMPLE_CRITERIA = [
  { name: '구현·작성', desc: '새 기능·문서·자료를 만든 작업', weight: 40, keywords: ['구현', '추가', '작성', 'feat', 'add'], kinds: ['Pull request', '페이지 생성'] },
  { name: '검토·개선', desc: '기존 결과물을 고치거나 검토한 작업', weight: 35, keywords: ['수정', '개선', '리뷰', 'fix', 'refactor'], kinds: ['코드 리뷰', '리뷰 댓글', '댓글', '남의 문서 편집'] },
  { name: '일정·협업 관리', desc: '이슈·일정·회의록 등 진행을 관리한 작업', weight: 25, keywords: ['회의', '일정', '배포', '설정', 'chore'], kinds: ['Issue', '속성 편집'] },
];

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hanmankeum' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || path}`);
  return res.json();
}

// GitHub 저장소에서 작성자·변경 기록 수집 (커밋 · PR · 리뷰 · 댓글 · 이슈)
// ponytail: 최대 300 커밋 / 100 PR / 30 PR 리뷰. 대형 저장소면 페이지네이션 확장.
export async function fetchGitHub(repo) {
  // [\w.-] 는 '..' 를 허용해 /repos/../orgs 처럼 경로를 벗어날 수 있다
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || repo.includes('..')) throw new Error('저장소는 owner/name 형식이어야 합니다.');
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const commits = await gh(`/repos/${repo}/commits?per_page=100&page=${page}`);
    for (const c of commits) {
      if (c.parents?.length > 1) continue; // 머지 커밋 제외
      out.push({
        ext_id: `commit:${c.sha}`, login: c.author?.login, tool: 'GitHub', kind: 'Commit',
        title: c.commit.message.split('\n')[0], body: c.commit.message, url: c.html_url,
        date: c.commit.author.date, ref: `Commit ${c.sha.slice(0, 7)}`,
      });
    }
    if (commits.length < 100) break;
  }
  const pulls = await gh(`/repos/${repo}/pulls?state=all&per_page=100`);
  for (const p of pulls) {
    out.push({
      ext_id: `pr:${p.number}`, login: p.user?.login, tool: 'GitHub', kind: 'Pull request',
      title: p.title, body: p.body || '', url: p.html_url, date: p.created_at, ref: `PR #${p.number}`,
    });
  }
  for (const p of pulls.slice(0, 30)) {
    for (const r of await gh(`/repos/${repo}/pulls/${p.number}/reviews`)) {
      if (!r.submitted_at || r.user?.login === p.user?.login) continue;
      out.push({
        ext_id: `review:${r.id}`, login: r.user?.login, tool: 'GitHub', kind: '코드 리뷰',
        title: `리뷰: ${p.title}`, body: r.body || '', url: r.html_url, date: r.submitted_at, ref: `Review · PR #${p.number}`,
      });
    }
  }
  // PR에 달린 리뷰 댓글만 수집 (다듬기). 일반 잡담 댓글은 점수 축이 없어 수집하지 않음
  for (const c of await gh(`/repos/${repo}/pulls/comments?per_page=100`)) {
    out.push({
      ext_id: `review-comment:${c.id}`, login: c.user?.login, tool: 'GitHub', kind: '리뷰 댓글',
      title: (c.body || '').split('\n')[0].slice(0, 120) || '리뷰 댓글', body: c.body || '', url: c.html_url, date: c.created_at, ref: `리뷰 댓글 · ${c.path || ''}`.trim(),
    });
  }
  for (const i of await gh(`/repos/${repo}/issues?state=all&per_page=100`)) {
    if (i.pull_request) continue;
    out.push({
      ext_id: `issue:${i.number}`, login: i.user?.login, tool: 'GitHub', kind: 'Issue',
      title: i.title, body: i.body || '', url: i.html_url, date: i.created_at, ref: `Issue #${i.number}`,
    });
  }
  return out;
}

// 분류 프롬프트 버전. 프롬프트를 고치면 올린다 → 각 기록에 어떤 버전으로 분류됐는지 남음
export const PROMPT_VERSION = 'criteria-classify-v1';
export const CRITERIA_VERSION = 'criteria-draft-v2';

// AI 사용 흔적 감지: AI 코딩 도구가 남기는 공동 작성자 표시, 생성 문구, 직접 남긴 [AI] 표시
// AI 사용은 감점 요소가 아니다. 사람이 한 부분과 AI가 도운 부분을 구분해 보여주기 위한 정보.
const AI_TOOLS = [
  ['Claude', /claude|anthropic/i], ['GitHub Copilot', /copilot/i], ['ChatGPT·Codex', /chatgpt|openai|codex/i],
  ['Gemini', /gemini/i], ['Cursor', /cursor/i],
];
export function detectAI(item) {
  const text = `${item.title || ''}\n${item.body || ''}`;
  const trailer = [...text.matchAll(/^co-authored-by:\s*(.+)$/gim)].map(m => m[1]).join('\n'); // 사람·AI 공동 작성자가 여럿일 수 있음
  const tool = AI_TOOLS.find(([, re]) => re.test(trailer))?.[0];
  if (tool) return { ai: true, note: `커밋 공동 작성자에 ${tool} 표시` };
  if (/generated with\s*\[?(claude|copilot|cursor|chatgpt)/i.test(text)) return { ai: true, note: 'AI 도구 생성 문구 포함' };
  if (/^\s*\[ai\]|ai-assisted|#ai사용/im.test(text)) return { ai: true, note: '작성자가 AI 사용을 표시' };
  return { ai: false, note: null };
}

// ── 교수 평가기준 정리 ──────────────────────────────────────────────

// 서버 검증: LLM이 낸 기준이든 교수가 고친 기준이든 같은 규칙으로 정리한다
export function normalizeCriteria(list, { strict = false } = {}) {
  const bad = msg => { if (strict) throw Object.assign(new Error(msg), { status: 400 }); };
  const items = (Array.isArray(list) ? list : []).slice(0, 6).map(c => ({
    name: String(c?.name || '').trim().slice(0, 20),
    desc: String(c?.desc || '').trim().slice(0, 120),
    weight: Math.round(Number(c?.weight) || 0),
    keywords: [...new Set((Array.isArray(c?.keywords) ? c.keywords : String(c?.keywords || '').split(/[,，]/))
      .map(k => String(k).trim().slice(0, 20)).filter(Boolean))].slice(0, 12),
    kinds: [...new Set((Array.isArray(c?.kinds) ? c.kinds : []).filter(k => KINDS.includes(k)))],
  })).filter(c => c.name);
  if (Array.isArray(list) && list.length > 6) bad('기준 항목은 6개까지입니다.');
  if (!items.length) { bad('기준 항목을 1개 이상 입력해 주세요.'); return []; }
  if (new Set(items.map(c => c.name)).size !== items.length) bad('기준 이름이 겹칩니다.');
  if (items.some(c => c.weight < 0 || c.weight > 100)) bad('가중치는 0~100 정수입니다.');
  const sum = items.reduce((a, c) => a + Math.max(0, c.weight), 0);
  if (sum !== 100) {
    bad('기준 가중치 합계는 100%여야 합니다.');
    // LLM 초안: 비율을 유지한 채 합 100으로 맞춤 (최대 나머지 방식)
    const raw = items.map(c => (sum ? Math.max(0, c.weight) / sum : 1 / items.length) * 100);
    const fl = raw.map(Math.floor);
    let left = 100 - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (left-- > 0) fl[i]++; });
    items.forEach((c, i) => { c.weight = fl[i]; });
  }
  return items;
}

const criteriaSchema = {
  type: 'object', additionalProperties: false, required: ['criteria', 'excluded'],
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'desc', 'weight', 'keywords', 'kinds'],
        properties: {
          name: { type: 'string' }, desc: { type: 'string' }, weight: { type: 'integer' },
          keywords: { type: 'array', items: { type: 'string' } },
          kinds: { type: 'array', items: { type: 'string', enum: KINDS } },
        },
      },
    },
    excluded: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['text', 'why'], properties: { text: { type: 'string' }, why: { type: 'string' } } },
    },
  },
};

const CRITERIA_SYSTEM = `대학 교수가 팀 프로젝트에 원래 쓰던 평가기준을 읽고, 협업 도구(GitHub·Notion) 작업 기록으로 확인할 수 있는 기여 항목으로 정리합니다.
규칙:
- 교수가 쓴 항목 이름과 표현을 최대한 그대로 씁니다. 새 이론이나 틀을 만들지 않습니다.
- 교수가 비율을 적었으면 그 비율을 weight로 옮기고, 없으면 비슷하게 나눕니다. 합계는 100입니다.
- 항목은 2~6개. desc는 어떤 작업 기록이 이 항목에 해당하는지 한 문장으로 씁니다.
- keywords는 이 항목의 작업 기록 제목에 실제로 나올 법한 짧은 단어(한국어·영어)를 3~8개 씁니다. PR·merge·commit처럼 모든 기록에 공통으로 나오는 말과, 특정 기능 이름(로그인 등)은 쓰지 않습니다.
- kinds는 이 항목에만 뚜렷하게 해당하는 활동 종류를 주어진 목록에서만 고릅니다. Commit·문서 편집처럼 여러 항목에 걸치는 종류는 넣지 않습니다. 해당이 없으면 빈 배열입니다.
- 작업 기록으로 확인할 수 없는 기준(발표 태도, 최종 결과물 품질, 출석, 오프라인 회의 참여 등)은 criteria에 넣지 말고 excluded에 원문과 이유를 적습니다. 이런 부분은 자기 기술·동료평가·교수 직접 평가로 확인합니다.
- 한국어로 씁니다.

활동 종류 목록: ${KINDS.join(', ')}`;

// AI를 쓸 수 없을 때: "항목 40%" 형태의 줄만 읽어 초안을 만든다 (키워드는 항목 이름의 단어)
export function ruleCriteria(rubric) {
  const items = [];
  for (const line of String(rubric).split(/\n|;|·(?=\s*\S+\s*\d)/)) {
    const m = line.match(/^\s*(?:[-*•\d.)]\s*)*(.+?)\s*[:：(\-–]?\s*(\d{1,3})\s*(?:%|점)/);
    if (!m) continue;
    const name = m[1].replace(/[\s:：(\-–]+$/, '').trim();
    if (!name) continue;
    items.push({ name, desc: `교수 기준 원문: ${line.trim().replace(/^[-*•\d.)\s]+/, '').slice(0, 80)}`, weight: Number(m[2]), keywords: name.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2), kinds: [] });
  }
  return items;
}

export async function draftCriteria(rubric) {
  if (hasAI()) {
    try {
      const out = await askJSON({ system: CRITERIA_SYSTEM, user: `교수의 평가기준:\n${rubric}`, schema: criteriaSchema, maxTokens: 3000 });
      const criteria = normalizeCriteria(out.criteria);
      if (criteria.length) {
        return { criteria, excluded: (out.excluded || []).slice(0, 8).map(x => ({ text: String(x.text).slice(0, 120), why: String(x.why).slice(0, 160) })), by: 'ai', prompt_version: CRITERIA_VERSION, model: MODEL };
      }
    } catch (e) {
      console.warn('기준 정리 AI 실패, 규칙으로 대체:', e.message);
    }
  }
  const criteria = normalizeCriteria(ruleCriteria(rubric));
  return { criteria, excluded: [], by: 'rule', prompt_version: null };
}

// ── 기록 분류 ──────────────────────────────────────────────────────

// 규칙 분류: 교수가 확정한 활동 종류(+2)와 키워드(+1씩)로 점수를 매겨 가장 높은 항목.
// 아무 것도 맞지 않으면 null('기준 밖') — 점수에 넣지 않고 교수가 볼 수 있게 남긴다.
export function ruleClassify(item, criteria) {
  const text = `${item.title || ''}`.toLowerCase();
  let best = null;
  criteria.forEach((c, i) => {
    const kind = c.kinds.includes(item.kind);
    const hits = c.keywords.filter(k => text.includes(k.toLowerCase()));
    const score = (kind ? 2 : 0) + hits.length;
    if (score > 0 && (!best || score > best.score)) best = { i, score, kind, hits };
  });
  if (!best) return { type: null, reason: '교수 기준의 활동 종류·키워드와 맞는 항목이 없어 기준 밖으로 두었습니다.' };
  const why = [best.kind && `활동 종류(${item.kind})`, best.hits.length && `'${best.hits.join("', '")}' 키워드`].filter(Boolean).join('와 ');
  return { type: best.i, reason: `${why}로 '${criteria[best.i].name}'에 연결했습니다.` };
}

const classifySchema = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['i', 'type', 'reason'],
        properties: { i: { type: 'integer' }, type: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
  },
};

const classifySystem = criteria => `대학 팀 프로젝트의 작업 기록을 교수가 정한 평가기준 항목 중 하나로 분류합니다. 평가가 아니라 분류만 합니다. 학생의 능력이나 성실성을 판단하지 마세요.
어느 항목에도 해당하지 않으면 type을 -1로 둡니다. reason은 한국어 한 문장으로, 기록의 어떤 부분을 근거로 그 항목에 연결했는지(또는 왜 해당이 없는지) 적습니다.

교수 기준 (인덱스: 이름 — 설명):
${criteria.map((c, i) => `${i}: ${c.name} — ${c.desc || '설명 없음'}${c.keywords.length ? ` (예: ${c.keywords.join(', ')})` : ''}`).join('\n')}`;

const ruleResult = (it, criteria) => { const r = ruleClassify(it, criteria); return { ...r, by: 'rule', rule_type: r.type, prompt_version: null }; };

export async function classify(items, criteria) {
  if (!items.length) return [];
  if (hasAI()) {
    try {
      const out = await askJSON({
        system: classifySystem(criteria),
        user: `작업 기록:\n${items.map((it, i) => `${i}. [${it.tool} ${it.kind}] ${it.title}${it.body && it.body !== it.title ? ` — ${it.body.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`).join('\n')}`,
        schema: classifySchema, maxTokens: 12000,
      });
      const map = new Map(out.items.map(x => [x.i, x]));
      return items.map((it, i) => {
        const x = map.get(i);
        const rule = ruleClassify(it, criteria);
        // AI 결과 옆에 규칙 판단도 남김 → 둘이 다르면 화면에서 '확인 필요'
        if (!x || !Number.isInteger(x.type) || x.type < -1 || x.type >= criteria.length) return ruleResult(it, criteria);
        return { type: x.type === -1 ? null : x.type, reason: String(x.reason).slice(0, 600), by: 'ai', rule_type: rule.type, prompt_version: PROMPT_VERSION };
      });
    } catch (e) {
      console.warn('AI 분류 실패, 규칙 분류로 대체:', e.message);
    }
  }
  return items.map(it => ruleResult(it, criteria));
}

// AI 분류가 규칙 판단과 다르고, 교수가 아직 확인하지 않은 기록 (규칙이 판단을 못 한 기록은 제외)
export const needsReview = r => (r.classified_by === 'ai' || r.classified_by === 'demo') && r.rule_type != null && r.rule_type !== r.type;


// GitHub 저장소의 기록을 수집해 저장한다. 수집 화면과 시연 시드가 함께 쓴다.
export async function ingestGitHub(teamId, repo, members, criteria) {
  const byLogin = new Map(members.filter(m => m.github).map(m => [m.github.toLowerCase(), m.id]));
  const known = new Set((await all('SELECT ext_id FROM records WHERE team_id = ?', teamId)).map(r => r.ext_id));
  const items = (await fetchGitHub(repo)).filter(it => !known.has(it.ext_id));
  let ai = 0;
  for (let i = 0; i < items.length; i += 80) {
    const chunk = items.slice(i, i + 80);
    const cls = await classify(chunk, criteria);
    for (const [j, it] of chunk.entries()) {
      if (cls[j].by === 'ai') ai++;
      const d = detectAI(it);
      await run('INSERT OR IGNORE INTO records (team_id, member_id, login, ext_id, tool, kind, title, body, url, ref, date, type, reason, classified_by, rule_type, prompt_version, ai_assisted, ai_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        teamId, byLogin.get((it.login || '').toLowerCase()) ?? null, it.login || null, it.ext_id, it.tool, it.kind, it.title.slice(0, 300),
        (it.body || '').slice(0, 4000), it.url, it.ref, it.date, cls[j].type, cls[j].reason, cls[j].by, cls[j].rule_type ?? null, cls[j].prompt_version ?? null,
        d.ai ? 1 : 0, d.note);
    }
  }
  return { added: items.length, ai };
}
