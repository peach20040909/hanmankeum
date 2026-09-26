// 발표 6페이지용 시연 클립(10~15초) 화면 캡처 — STEP 01 착수 → 02 수집 → 03 분류 → 04 리포트
// 사용: node tools/capture-demo.mjs <출력폴더>   (로컬 서버가 3000에서 떠 있어야 함)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
mkdirSync(OUT, { recursive: true });

const call = async (path, key, method = 'GET', body) => {
  const res = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body && JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status} ${data.error}`);
  return data;
};

// 시나리오 팀(착수~학기 중)과 마감된 예시 팀(분류·리포트)
const t = await call('/teams', null, 'POST', {
  course: '캡스톤디자인(2)', name: '팀 3', project: '캠퍼스 분실물 매칭 앱',
  start_date: '2026-09-07', deadline: '2026-12-15', weights: [40, 30, 15, 15],
  members: [
    { name: '박준호', role: '팀장 · 개발', github: 'junho-park' },
    { name: '김서연', role: '기획 · 자료 제작', github: 'seoyeon-kim' },
    { name: '이다은', role: '개발 · 테스트', github: 'daeun-lee' },
    { name: '최민재', role: '시연 · 현장 준비', github: 'minjae-choi' },
  ],
});
const P = t.prof_key, K = t.team.members.map(m => m.key), TID = t.team.id;
const demo = await call('/demo', null, 'POST');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1.5 });

let n = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await wait(400); await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }); console.log(n, name); };
const open = async (key, view = '') => { await page.goto(`${BASE}/#/join/${key}${view ? `/${view}` : ''}`, { waitUntil: 'networkidle0' }); await wait(900); };
const center = sel => page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);

// ── STEP 01 착수: 학생 동의 → 교수 가중치 → 잠금
await open(K[0]);
await page.click('#consent-check');
await shot('consent');
await page.click('#consent-next');
await wait(1200);
for (const k of K.slice(1)) await call(`/teams/${TID}/consent`, k, 'POST', { agree: true });

await open(P, 'setup');
await center('#weight-editor');
await shot('weights');

for (const k of K) await call(`/teams/${TID}/confirm`, k, 'POST');
await open(P, 'setup');
await center('.setup-step:nth-of-type(5)');
await page.click('[data-action="lock"]');
await wait(1500);
await center('.setup-banner');
await shot('locked');

// ── STEP 02 수집: 학기 중 학생 화면은 조용함
await open(K[0], 'setup');
await shot('quiet');

// ── 마감 후: 학생 익명 동료평가 폼 (로그에 없는 기여)
await call(`/teams/${TID}/close`, P, 'POST');
await open(K[0], 'peer');
await center('.peer-card');
await page.select('.peer-card [data-f="axis"]', '2');
await page.select('.peer-card [data-f="basis"]', '함께 수행');
await page.type('.peer-card [data-f="did"]', '11/28 리허설 장소를 섭외하고 시연 장비를 점검했습니다.', { delay: 8 });
// 익명 안내 + 평가 대상 + 1~3번 문항이 한 화면에 들어오도록
await page.evaluate(() => window.scrollTo({ top: document.querySelector('.peer-card').offsetTop - 150 }));
await shot('peer');

// ── STEP 03 분류: 활동 근거 목록(4축 태그)
await open(demo.prof_key, 'evidence');
await center('.evidence-list');
await shot('classified');

// ── STEP 04 리포트: 기여율 + 근거 상세
await open(demo.prof_key, 'report');
await center('.chart-card');
await shot('report');
await page.click('.contribution-row');
await wait(1000);
await shot('detail');
await page.evaluate(() => document.querySelectorAll('.contribution-row')[3].click());
await wait(900);
await center('#modal .unverified');
await shot('testimony');

await browser.close();
console.log('done');
