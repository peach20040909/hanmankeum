import { createHmac, timingSafeEqual } from 'node:crypto';

// Notion 웹훅 서명: X-Notion-Signature = "sha256=" + HMAC-SHA256(verification_token, 원본 body)
export function verifySignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const got = Buffer.from(String(header));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// https://www.notion.so/Title-1a2b...(32 hex) 또는 UUID → 하이픈 포함 UUID
export function parsePageId(input) {
  // ID는 항상 경로 끝 32자리 (제목 slug가 hex 문자로 끝나도 안전)
  const hex = String(input || '').trim().split(/[?#]/)[0].replace(/\/+$/, '').replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0];
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase() : null;
}

async function notion(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03' },
  });
  if (!res.ok) throw new Error(`Notion ${res.status} ${path}`);
  return res.json();
}

const PARENT_PATH = { page_id: 'pages', block_id: 'blocks', database_id: 'databases', data_source_id: 'data_sources' };

// 페이지에서 워크스페이스까지 상위 ID 목록 (팀 루트 페이지 찾기용)
// ponytail: 이벤트마다 최대 10단계 조회, 캐시 없음. 이벤트가 많아지면 id→parent 캐시 추가.
export async function ancestors(pageId) {
  const ids = [pageId];
  let path = `/pages/${pageId}`;
  for (let i = 0; i < 10 && path; i++) {
    const obj = await notion(path).catch(() => null);
    const p = obj?.parent;
    const id = p?.[p?.type];
    if (!id || !PARENT_PATH[p.type]) break;
    ids.push(id);
    path = `/${PARENT_PATH[p.type]}/${id}`;
  }
  return ids;
}

export async function pageInfo(pageId) {
  const page = await notion(`/pages/${pageId}`).catch(() => null);
  const title = page && Object.values(page.properties || {}).find(p => p.type === 'title')?.title?.map(t => t.plain_text).join('');
  return { title: title || '(제목 없음)', url: page?.url || null };
}

export async function userInfo(userId) {
  const u = await notion(`/users/${userId}`).catch(() => null);
  return { name: u?.name || userId.slice(0, 8), email: u?.person?.email?.toLowerCase() || null };
}

export const KIND = { 'page.created': '페이지 생성', 'page.content_updated': '문서 편집', 'page.properties_updated': '속성 편집' };
