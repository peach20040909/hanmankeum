import Anthropic from '@anthropic-ai/sdk';

// 점수에 들어가는 3축 (예선 5유형 · 4축 폐기)
export const AXES = ['만들기', '다듬기', '이끌기'];
const AXIS_DEF = [
  '만들기(Create): 새 결과물을 만듦 — 신규 커밋, 새 문서·페이지, 새 슬라이드',
  '다듬기(Refine): 기존 결과물을 고치거나 검토 — 남의 문서 편집, PR 리뷰·리뷰 댓글, 버그 수정',
  '이끌기(Lead): 기록에 남는 관리 — 이슈·태스크 생성과 배정, 마일스톤, 회의록 작성',
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
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('저장소는 owner/name 형식이어야 합니다.');
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
export const PROMPT_VERSION = 'mrl-3axis-v2';

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

const REFINE = /\b(fix(es|ed)?|bug|hotfix|refactor|typo|style|lint|improve|update|clean ?up|polish|tweak|review)\b|수정|개선|보완|리팩|오타|정리|다듬|검토/i;
const LEAD = /\b(chore|ci|cd|config|release|deploy|build|setup|schedule|milestone|roadmap)\b|회의록|회의|일정|배분|태스크|담당|마일스톤|계획|배포|설정/i;

// 규칙 분류: 활동 종류가 축을 정하고, 모호한 것만 제목 키워드로 판단 (API 키 없을 때 · AI 실패 시)
export function ruleClassify(item) {
  const by = (type, why) => ({ type, reason: `${why} ${AXES[type]}에 연결했습니다.` });
  const m = re => item.title.match(re)?.[0];
  switch (item.kind) {
    case '코드 리뷰': return by(1, '다른 팀원의 PR을 검토한 리뷰라');
    case '리뷰 댓글': return by(1, '코드 리뷰 과정에서 남긴 댓글이라');
    case 'Issue': return by(2, '할 일·담당을 등록한 이슈라');
  }
  if (m(LEAD)) return by(2, `'${m(LEAD)}' 키워드로`);
  if (m(REFINE)) return by(1, `'${m(REFINE)}' 키워드로`);
  return by(0, '새 결과물을 만든 기록으로 보고');
}

export async function classify(items) {
  if (!items.length) return [];
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const res = await client.beta.messages.create({
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
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
            },
          },
        },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: `대학 팀 프로젝트의 작업 기록을 MRL 3축 중 하나로 분류합니다. 평가가 아니라 분류만 합니다. 학생의 능력이나 성실성을 판단하지 마세요. reason은 한국어 한 문장으로, 기록의 어떤 부분을 근거로 그 축에 연결했는지 적습니다.\n\n3축(인덱스: 정의):\n${AXIS_DEF.map((d, i) => `${i}: ${d}`).join('\n')}`,
        messages: [{
          role: 'user',
          content: `작업 기록:\n${items
            .map((it, i) => `${i}. [${it.tool} ${it.kind}] ${it.title}${it.body && it.body !== it.title ? ` — ${it.body.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`)
            .join('\n')}`,
        }],
      });
      if (res.stop_reason === 'end_turn') {
        const text = res.content.find(b => b.type === 'text')?.text;
        const map = new Map(JSON.parse(text).items.map(x => [x.i, x]));
        return items.map((it, i) => {
          const x = map.get(i);
          const rule = ruleClassify(it);
          // AI 결과 옆에 규칙 판단도 남김 → 둘이 다르면 화면에서 '확인 필요'
          return x && x.type >= 0 && x.type < AXES.length
            ? { type: x.type, reason: x.reason, by: 'ai', rule_type: rule.type, prompt_version: PROMPT_VERSION }
            : { ...rule, by: 'rule', rule_type: rule.type, prompt_version: null };
        });
      }
      console.warn('AI 분류 중단:', res.stop_reason);
    } catch (e) {
      console.warn('AI 분류 실패, 규칙 분류로 대체:', e.message);
    }
  }
  return items.map(it => { const rule = ruleClassify(it); return { ...rule, by: 'rule', rule_type: rule.type, prompt_version: null }; });
}

// AI 분류가 규칙 판단과 다르고, 교수가 아직 확인하지 않은 기록
export const needsReview = r => (r.classified_by === 'ai' || r.classified_by === 'demo') && r.rule_type != null && r.rule_type !== r.type;
