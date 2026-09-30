// 발표 PPT 삽입용 UI 캡처 (2배 해상도) — 대본 5구간에 맞춘 7장
// 사용: node tools/capture-slides.mjs <출력폴더>   (로컬 서버가 3000에서 떠 있어야 함)
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

const t = await call('/teams', null, 'POST', {
  course: '캡스톤디자인(2)', name: '팀 3', project: '캠퍼스 분실물 매칭 앱',
  start_date: '2026-09-07', deadline: '2026-12-15', weights: [40, 35, 25],
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
await page.setViewport({ width: 1344, height: 1008, deviceScaleFactor: 2 }); // 2688x2016 PNG (영상 화면 영역과 동일 비율)

const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await wait(400); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
const open = async (key, view = '') => { await page.goto(`${BASE}/#/join/${key}${view ? `/${view}` : ''}`, { waitUntil: 'networkidle0' }); await wait(900); };
const center = async (sel, block = 'center') => { await page.evaluate((s, b) => document.querySelector(s)?.scrollIntoView({ block: b }), sel, block); await wait(350); };

// 1) 0~5초 · 팀 초대 · 도구 연결
await open(P, 'setup');
await page.evaluate(() => window.scrollTo({ top: 0 }));
await wait(400);
await shot('01_팀초대');
await center('.setup-step:nth-of-type(2)', 'start');
await shot('02_도구연결');

// 2) 5~14초 · 가중치 설정 → 잠금
await center('#weight-editor');
await page.click('[data-action="preset"][data-i="1"]');
await wait(500);
await shot('03_가중치설정');
await page.click('[data-action="w-save"]');
await wait(1200);
for (const k of K) await call(`/teams/${TID}/confirm`, k, 'POST');
await open(P, 'setup');
await page.click('[data-action="lock"]');
await wait(1600);
await center('.setup-step:nth-of-type(4)');
await shot('04_학생확인_기준잠금');

// 3) 14~20초 · 기록 수집 · 자동 분류
await open(K[0], 'setup');
await page.evaluate(() => window.scrollTo({ top: 0 }));
await wait(400);
await shot('05_학기중_학생화면');
await open(demo.prof_key, 'evidence');
await center('.evidence-list', 'start');
await shot('06_기록수집_자동분류');

// 4) 20~29초 · 익명 동료평가
await call(`/teams/${TID}/close`, P, 'POST');
await open(K[0], 'peer');
await page.select('.peer-card [data-f="axis"]', '2');
await page.select('.peer-card [data-f="basis"]', '함께 수행');
await page.click('.peer-card [data-f="did"]');
await page.type('.peer-card [data-f="did"]', '11/28 리허설 장소를 섭외하고 시연 장비를 점검했습니다.', { delay: 4 });
await page.evaluate(() => window.scrollTo({ top: 0 }));
await wait(400);
await shot('07_익명동료평가');

// 5) 29~40초 · 기여도 리포트 → 근거 → 원본 기록
await open(demo.prof_key, 'report');
await center('.chart-card', 'start');
await shot('08_기여도리포트');
await page.click('.contribution-row');
await wait(1200);
await shot('09_산출근거_상세');
await page.evaluate(() => document.querySelector('#modal .evidence-item')?.click());
await wait(1200);
await shot('10_원본기록_확인');

await browser.close();
console.log('done');
