import Anthropic from '@anthropic-ai/sdk';

// 기여 4축 (예선 5유형 폐기)
export const AXES = ['산출물 생성', '산출물 개선', '조율/관리', '의사소통'];
const AXIS_DEF = [
  '산출물 생성: 새 결과물을 만듦 (문서 작성, 커밋, 슬라이드 추가, 기능 구현)',
  '산출물 개선: 남의 결과물을 수정·보완 (문서 편집, PR 리뷰, 버그·오탈자 수정, 리팩터링)',
  '조율/관리: 팀 진행을 움직임 (일정 등록, 태스크 배분, 이슈 생성, 회의 소집, 배포·설정)',
  '의사소통: 논의 참여 (댓글, 메시지, 피드백)',
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
  for (const c of await gh(`/repos/${repo}/issues/comments?per_page=100`)) {
    out.push({
      ext_id: `comment:${c.id}`, login: c.user?.login, tool: 'GitHub', kind: '댓글',
      title: (c.body || '').split('\n')[0].slice(0, 120) || '댓글', body: c.body || '', url: c.html_url, date: c.created_at, ref: 'Issue/PR 댓글',
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

const IMPROVE = /\b(fix(es|ed)?|bug|hotfix|refactor|typo|style|lint|improve|update|clean ?up|polish|tweak)\b|수정|개선|보완|리팩|오타|정리|다듬/i;
const MANAGE = /\b(chore|ci|cd|config|release|deploy|build|merge|setup|schedule|milestone)\b|일정|회의|배분|태스크|담당|관리|계획|배포|설정/i;
const TALK = /\b(feedback|discuss|question|reply)\b|피드백|논의|의견|댓글|질문|답변|공유/i;

// 규칙 분류: 활동 종류가 축을 정하고, 모호한 것만 제목 키워드로 판단 (API 키 없을 때 · AI 실패 시)
export function ruleClassify(item) {
  const by = (type, why) => ({ type, reason: `${why} ${AXES[type]}에 연결했습니다.` });
  const m = re => item.title.match(re)?.[0];
  switch (item.kind) {
    case '코드 리뷰': return by(1, '다른 팀원의 PR을 검토한 리뷰라');
    case '댓글': return by(3, '논의에 참여한 댓글이라');
    case 'Issue': return by(2, '할 일·문제를 등록한 이슈라');
  }
  if (m(TALK) && item.tool !== 'GitHub') return by(3, `'${m(TALK)}' 키워드로`);
  if (m(MANAGE)) return by(2, `'${m(MANAGE)}' 키워드로`);
  if (m(IMPROVE)) return by(1, `'${m(IMPROVE)}' 키워드로`);
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
        system: `대학 팀 프로젝트의 작업 기록을 기여 4축 중 하나로 분류합니다. 평가가 아니라 분류만 합니다. reason은 한국어 한 문장으로, 어떤 근거로 그 축에 연결했는지 적습니다.\n\n4축(인덱스: 정의):\n${AXIS_DEF.map((d, i) => `${i}: ${d}`).join('\n')}`,
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
          return x && x.type >= 0 && x.type < AXES.length ? { type: x.type, reason: x.reason, by: 'ai' } : { ...ruleClassify(it), by: 'rule' };
        });
      }
      console.warn('AI 분류 중단:', res.stop_reason);
    } catch (e) {
      console.warn('AI 분류 실패, 규칙 분류로 대체:', e.message);
    }
  }
  return items.map(it => ({ ...ruleClassify(it), by: 'rule' }));
}
