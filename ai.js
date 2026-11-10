import Anthropic from '@anthropic-ai/sdk';

// 생성형 AI(LLM) 호출을 한 곳에 모은다.
// - 저렴한 모델을 기본으로 쓴다. 배포 환경변수 HANMANKEUM_MODEL로 바꿀 수 있다.
// - 응답은 JSON 스키마로 강제(structured outputs)하고, 그래도 서버가 다시 검증한다.
// - ANTHROPIC_API_KEY가 없거나 호출이 실패하면 호출한 쪽이 규칙 기반으로 대체하고, 화면에 '규칙'으로 표시한다.
export const MODEL = process.env.HANMANKEUM_MODEL || 'claude-haiku-5-5';
export const hasAI = () => !!process.env.ANTHROPIC_API_KEY;

let client;
export async function askJSON({ system, user, schema, maxTokens = 4000 }) {
  client ||= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  if (res.stop_reason !== 'end_turn') throw new Error(`AI 응답 중단: ${res.stop_reason}`);
  const text = res.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('AI 응답에 본문이 없습니다.');
  return JSON.parse(text);
}
