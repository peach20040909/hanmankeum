// Vercel 함수 진입점 — /api/* 전체를 이 함수 하나가 받는다 (vercel.json rewrites).
// Web 표준 fetch 핸들러라 원본 바이트(Notion 서명 검증)를 그대로 읽을 수 있다.
import { handle } from '../handler.js';

export default { fetch: handle };
