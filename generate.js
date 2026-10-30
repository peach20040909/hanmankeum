import Anthropic from '@anthropic-ai/sdk';
import { AXES } from './collect.js';

// 생성형 AI가 문장을 쓰는 기능 2가지: 근거 인용 기여 요약 · 자기 기술 초안
// 원칙: AI가 쓴 문장은 그대로 믿지 않는다. 서버가 근거 번호를 검증하고, 통과한 문장만 보여준다.
export const SUMMARY_VERSION = 'summary-v1';
export const DRAFT_VERSION = 'selfdraft-v1';

// 평가·판단 표현: 기록에서 확인할 수 없는 능력·태도 판단이므로 문장째 제외
const JUDGE = /성실|불성실|능력|열심|게으|뛰어|우수|훌륭|탁월|부족|태만|무임승차|소극|적극적으로|책임감|노력했|헌신|기여도가 (높|낮)/;

const refLabel = r => r.ref || `${r.tool} ${r.kind}`;

// AI에 넘기는 기록 목록: 번호(n)는 이 요청 안에서만 쓰는 임시 번호
function recordLines(records) {
  return records.map((r, i) => `[${i + 1}] (${r.tool} ${r.kind}, ${String(r.date || '').slice(0, 10)}, ${AXES[r.type] ?? '미분류'}) ${r.title}${r.body ? ` — ${r.body.slice(0, 160).replace(/\s+/g, ' ')}` : ''}${r.ai_assisted ? ' [AI 도움 표시]' : ''}`).join('\n');
}

// 2글자 조각 겹침으로 문장이 인용한 기록과 실제로 관련 있는지 점검 (형태소 분석 없이 쓰는 간단한 지표)
const grams = s => {
  const t = String(s).replace(/\[#?\d+\]|\(근거[^)]*\)/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
};
export function overlap(sentence, records) {
  const a = grams(sentence);
  const b = grams(records.map(r => `${r.title} ${r.body || ''}`).join(' '));
  if (!a.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / a.size;
}

// AI가 낸 문장 검증: 근거 번호 → 실제 기록 id로 변환, 통과 못한 문장은 이유와 함께 제외 목록으로
export function validateSentences(raw, records) {
  const kept = [], dropped = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const text = String(s?.text || '').replace(/\s*\[#?\d+\]/g, '').trim();
    if (!text) continue;
    const nums = [...new Set((Array.isArray(s.refs) ? s.refs : []).map(Number))];
    const valid = nums.filter(n => Number.isInteger(n) && n >= 1 && n <= records.length);
    const invalid = nums.filter(n => !valid.includes(n));
    const cited = valid.map(n => records[n - 1]);
    let reason = null;
    if (!nums.length) reason = '근거 기록 번호가 없음';
    else if (!valid.length) reason = `존재하지 않는 기록 번호 인용 (${invalid.join(', ')})`;
    else if (JUDGE.test(text)) reason = '기록으로 확인할 수 없는 능력·태도 평가 표현';
    if (reason) { dropped.push({ text, reason }); continue; }
    const score = overlap(text, cited);
    kept.push({ text, refs: cited.map(r => r.id), ...(invalid.length ? { note: `없는 번호 ${invalid.join(', ')}는 제외함` } : {}), ...(score < 0.12 ? { weak: true } : {}) });
  }
  return { kept, dropped };
}

const sentenceSchema = {
  type: 'object', additionalProperties: false, required: ['sentences'],
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'refs'],
        properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'integer' } } },
      },
    },
  },
};

async function askSentences(system, user) {
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: sentenceSchema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason !== 'end_turn') throw new Error(`AI 응답 중단: ${res.stop_reason}`);
  return JSON.parse(res.content.find(b => b.type === 'text').text).sentences;
}

const SUMMARY_SYSTEM = `대학 팀 프로젝트에서 한 학생의 작업 기록을 읽고, 그 학생이 한 일을 3~5문장으로 요약합니다.
규칙:
- 모든 문장은 반드시 근거가 된 기록 번호를 refs에 넣습니다. 기록에서 직접 확인되는 사실만 씁니다.
- 학생의 능력·성실성·태도를 평가하지 않습니다. "열심히", "뛰어난", "성실하게" 같은 표현을 쓰지 않습니다.
- 기록에 없는 일, 결과물의 품질, 다른 팀원과의 비교는 쓰지 않습니다.
- [AI 도움 표시]가 있는 기록은 "AI 도움 표시가 있다"고 사실대로 밝힙니다.
- 3인칭 평서문("~했다")으로, 한국어로 씁니다. 문장 안에 번호를 적지 말고 refs에만 넣습니다.`;

const DRAFT_SYSTEM = `대학 팀 프로젝트를 마친 학생이 자기 기술을 쓸 수 있도록, 본인의 작업 기록만으로 초안을 3~6문장 씁니다.
규칙:
- 1인칭("저는 ~했습니다")으로 씁니다. 학생이 고쳐 쓸 출발점일 뿐입니다.
- 모든 문장은 근거 기록 번호를 refs에 넣고, 기록에서 확인되는 사실만 씁니다.
- 자기 자랑이나 능력·태도 평가("열심히", "주도적으로 뛰어나게")를 넣지 않습니다.
- 기록에 없는 오프라인 활동은 지어내지 않습니다. 대신 마지막 문장 없이 끝냅니다.
- [AI 도움 표시]가 있는 기록은 AI 도움을 받았다고 밝힙니다.
- 문장 안에 번호를 적지 말고 refs에만 넣습니다.`;

// AI를 쓸 수 없을 때(키 없음·호출 실패) 기록 제목만으로 만드는 규칙 기반 문장 — 화면에 '규칙 문장'으로 표시
function ruleSentences(records, firstPerson) {
  return AXES.map((axis, k) => {
    const rs = records.map((r, i) => ({ r, n: i + 1 })).filter(x => x.r.type === k);
    if (!rs.length) return null;
    const top = rs.slice(0, 2).map(x => `'${x.r.title}'`).join(', ');
    const more = rs.length > 2 ? ` 등 ${rs.length}건` : '';
    return {
      text: firstPerson ? `저는 ${top}${more}의 작업으로 ${axis}에 참여했습니다.` : `${top}${more}의 기록이 ${axis}에 연결된다.`,
      refs: rs.slice(0, 3).map(x => x.n),
    };
  }).filter(Boolean);
}

async function generate(kind, member, records) {
  const firstPerson = kind === 'draft';
  const version = firstPerson ? DRAFT_VERSION : SUMMARY_VERSION;
  if (!records.length) return { kept: [], dropped: [], by: 'none', prompt_version: null, generated: 0 };
  let raw = null, by = 'rule';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      raw = await askSentences(firstPerson ? DRAFT_SYSTEM : SUMMARY_SYSTEM, `학생: ${member.name}${member.role ? ` (역할: ${member.role})` : ''}\n작업 기록:\n${recordLines(records)}`);
      by = 'ai';
    } catch (e) {
      console.warn(`${kind} 생성 실패, 규칙 문장으로 대체:`, e.message);
    }
  }
  if (!raw) raw = ruleSentences(records, firstPerson);
  const { kept, dropped } = validateSentences(raw, records);
  return { kept, dropped, by, prompt_version: by === 'ai' ? version : null, generated: raw.length };
}

export const summarize = (member, records) => generate('summary', member, records);
export const draftStatement = (member, records) => generate('draft', member, records);

// 초안 문장을 학생이 고칠 텍스트로: 문장 끝에 근거를 사람이 읽을 수 있게 붙임 (지워도 됨)
export function draftText(kept, records) {
  const byId = new Map(records.map(r => [r.id, r]));
  return kept.map(s => `${s.text.replace(/[.。]\s*$/, '')} (근거: ${s.refs.map(id => refLabel(byId.get(id))).join(', ')}).`).join('\n').slice(0, 1000);
}

// 초안과 학생 최종본 비교: 문장 단위로 그대로 둔 것·고친 것·새로 쓴 것을 세고, 전체 수정률(%)을 계산
const splitSentences = t => String(t).replace(/\s*\[#?\d+\]|\s*\(근거[^)]*\)/g, '').split(/(?<=[.!?。])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const dice = (a, b) => {
  const x = grams(a), y = grams(b);
  if (!x.size && !y.size) return 1;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return (2 * n) / (x.size + y.size);
};
export function compareDraft(draft, final) {
  const ds = splitSentences(draft), fs = splitSentences(final);
  let kept = 0, edited = 0, added = 0;
  for (const f of fs) {
    const best = Math.max(0, ...ds.map(d => dice(d, f)));
    if (best >= 0.98) kept++; else if (best >= 0.5) edited++; else added++;
  }
  const removed = ds.filter(d => !fs.some(f => dice(d, f) >= 0.5)).length;
  return { kept, edited, added, removed, changed: Math.round((1 - dice(draft, final)) * 100) };
}
