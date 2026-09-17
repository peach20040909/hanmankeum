import Anthropic from '@anthropic-ai/sdk';

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hanmankeum' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || path}`);
  return res.json();
}

// GitHub 저장소에서 작성자·변경 기록 수집 (커밋 · PR · 리뷰 · 이슈)
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
  for (const i of await gh(`/repos/${repo}/issues?state=all&per_page=100`)) {
    if (i.pull_request) continue;
    out.push({
      ext_id: `issue:${i.number}`, login: i.user?.login, tool: 'GitHub', kind: 'Issue',
      title: i.title, body: i.body || '', url: i.html_url, date: i.created_at, ref: `Issue #${i.number}`,
    });
  }
  return out;
}

const RULES = [
  [/기획|pm|조사|분석|요구|명세|보고서|고찰/i, /\b(docs?|readme|spec|plan|design|wiki)\b|기획|요구|명세|문서|설계|조사/i],
  [/qa|테스트|검증|test/i, /\b(test|tests|fix|bug|hotfix|qa|lint)\b|테스트|버그|수정|검증/i],
  [/발표|ppt|슬라이드|제안서|ir/i, /\b(ppt|slides?|presentation|demo)\b|발표|슬라이드|시연/i],
  [/조율|일정|협업|관리|인프라/i, /\b(merge|chore|ci|cd|config|release|deploy|build)\b|일정|회의|배포|설정/i],
];

// 키워드 규칙 분류 (ANTHROPIC_API_KEY 없을 때 · AI 실패 시)
export function ruleClassify(item, categories, weights) {
  const hay = item.title; // 종류 라벨('문서 편집' 등)은 분류 근거로 쓰지 않음
  for (const [catRe, textRe] of RULES) {
    const idx = categories.findIndex(c => catRe.test(c));
    const m = hay.match(textRe);
    if (idx >= 0 && (m || (item.kind === '코드 리뷰' && catRe.test('qa')))) {
      return { type: idx, reason: m ? `'${m[0]}' 키워드 규칙으로 ${categories[idx]} 유형에 연결했습니다.` : `코드 리뷰 기록을 ${categories[idx]} 유형에 연결했습니다.` };
    }
  }
  const make = categories.findIndex(c => /제작|개발|프론트|백엔드|구현|실험/.test(c));
  const idx = make >= 0 ? make : weights.indexOf(Math.max(...weights));
  return { type: idx, reason: `특정 키워드가 없어 기본 작업 유형(${categories[idx]})으로 연결했습니다.` };
}

export async function classify(items, categories, weights) {
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
        system: '대학 팀 프로젝트의 작업 기록을 팀이 합의한 기여 유형 중 하나로 분류합니다. 평가가 아니라 분류만 합니다. reason은 한국어 한 문장으로, 어떤 근거로 그 유형에 연결했는지 적습니다.',
        messages: [{
          role: 'user',
          content: `기여 유형(인덱스: 이름): ${categories.map((c, i) => `${i}: ${c}`).join(', ')}\n\n작업 기록:\n${items
            .map((it, i) => `${i}. [${it.tool} ${it.kind}] ${it.title}${it.body && it.body !== it.title ? ` — ${it.body.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`)
            .join('\n')}`,
        }],
      });
      if (res.stop_reason === 'end_turn') {
        const text = res.content.find(b => b.type === 'text')?.text;
        const map = new Map(JSON.parse(text).items.map(x => [x.i, x]));
        return items.map((it, i) => {
          const x = map.get(i);
          return x && x.type >= 0 && x.type < categories.length
            ? { type: x.type, reason: x.reason, by: 'ai' }
            : { ...ruleClassify(it, categories, weights), by: 'rule' };
        });
      }
      console.warn('AI 분류 중단:', res.stop_reason);
    } catch (e) {
      console.warn('AI 분류 실패, 규칙 분류로 대체:', e.message);
    }
  }
  return items.map(it => ({ ...ruleClassify(it, categories, weights), by: 'rule' }));
}
