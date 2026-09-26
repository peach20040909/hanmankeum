// 한만큼 시연 영상 녹화 — 가상 커서로 실제 클릭하며 화면을 연속 캡처한다.
// 사용: node tools/record-demo.mjs <출력폴더>   (로컬 서버가 3000에서 떠 있어야 함)
// 결과: <출력폴더>/f######.jpg + timeline.json (프레임 시각·단계 구간)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3000';
const VW = 960, VH = 720; // 왼쪽 320px 단계 패널 + 오른쪽 앱 화면 = 1280x720
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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1.5 });

// ── 가상 커서: 페이지 안에 그려서 녹화에 그대로 담긴다
const CURSOR = `
if (!window.__cur) {
  const c = document.createElement('div');
  c.id = '__cursor';
  c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 22 L7.5 17 L11 25.5 L15 23.5 L11.5 15.5 L19 15 Z" fill="#fff" stroke="#1b2140" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', filter: 'drop-shadow(0 3px 6px rgba(20,25,50,.35))', transform: 'translate(640px, 400px)' });
  document.body.appendChild(c);
  window.__cur = { el: c, x: 640, y: 400 };
  window.__moveTo = (x, y, ms) => new Promise(done => {
    const s = window.__cur, x0 = s.x, y0 = s.y, t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / ms, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      s.x = x0 + (x - x0) * e; s.y = y0 + (y - y0) * e;
      s.el.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
      p < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });
  window.__ripple = () => {
    const s = window.__cur, r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', left: (s.x - 16) + 'px', top: (s.y - 16) + 'px', width: '32px', height: '32px', borderRadius: '50%', border: '2px solid #4b7cf3', background: 'rgba(75,124,243,.18)', zIndex: 2147483646, pointerEvents: 'none', transition: 'all .45s ease-out' });
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  };
}`;
const cursor = async () => page.evaluate(CURSOR);

const wait = ms => new Promise(r => setTimeout(r, ms));
const center = async sel => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) throw new Error('no element: ' + s);
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

const moveTo = async (sel, ms = 700) => { const { x, y } = await center(sel); await page.evaluate((x, y, ms) => window.__moveTo(x, y, ms), x, y, ms); };
const click = async (sel, after = 700) => {
  await moveTo(sel);
  await wait(160);
  await page.evaluate(() => window.__ripple());
  await page.click(sel);
  await wait(after);
  await cursor();
};
const scrollTo = async (sel, ms = 700) => { await page.evaluate((s, ms) => new Promise(done => { const el = document.querySelector(s); const to = window.scrollY + el.getBoundingClientRect().top - 150, from = window.scrollY, t0 = performance.now(); const step = now => { const p = Math.min((now - t0) / ms, 1), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; window.scrollTo(0, from + (to - from) * e); p < 1 ? requestAnimationFrame(step) : done(); }; requestAnimationFrame(step); }), sel, ms); };
const open = async (key, view = '') => { await page.goto(`${BASE}/#/join/${key}${view ? `/${view}` : ''}`, { waitUntil: 'networkidle0' }); await wait(900); await cursor(); };

// ── 녹화 시작
const cdp = await page.target().createCDPSession();
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  frames.push({ t: metadata.timestamp, data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
});
const steps = [];
const step = name => steps.push({ name, t: Date.now() / 1000 });
const T0 = () => frames.length ? frames[0].t : 0;

await open(P, 'setup');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1000, everyNthFrame: 1 });
await wait(1200);

// 1. 팀 초대 · 도구 연결 (교수)
step('invite');
await wait(2200);
await scrollTo('.setup-step:nth-of-type(2)', 900);
await wait(2600);

// 2. MRL 가중치 설정 · 잠금 (교수)
step('weights');
await scrollTo('#weight-editor', 900);
await wait(1800);
await click('[data-action="preset"][data-i="1"]', 1600);
await wait(900);
await click('[data-action="w-save"]', 2200);
await wait(900);
for (const k of K) await call(`/teams/${TID}/confirm`, k, 'POST');
await open(P, 'setup');
await scrollTo('[data-action="lock"]', 900);
await wait(1200);
await click('[data-action="lock"]', 2400);
await wait(1200);

// 3. 학기 중 수집 (학생 조용한 화면 → 교수 활동 근거)
step('collect');
await open(K[0], 'setup');
await wait(3200);
await open(demo.prof_key, 'evidence');
await wait(1400);
await scrollTo('.evidence-list', 900);
await wait(3000);

// 4. 익명 동료평가 (학생)
step('peer');
await call(`/teams/${TID}/close`, P, 'POST');
await open(K[0], 'peer');
await wait(2400);
await scrollTo('.peer-card', 900);
await wait(1200);
await moveTo('.peer-card [data-f="axis"]');
await page.evaluate(() => window.__ripple());
await page.select('.peer-card [data-f="axis"]', '2');
await wait(1400);
await moveTo('.peer-card [data-f="did"]');
await page.evaluate(() => window.__ripple());
await page.click('.peer-card [data-f="did"]');
await page.type('.peer-card [data-f="did"]', '11/28 리허설 장소를 섭외하고 시연 장비를 점검했습니다.', { delay: 45 });
await wait(2000);
await cursor();

// 5. 기여도 리포트 (교수)
step('report');
await open(demo.prof_key, 'report');
await scrollTo('.chart-card', 900);
await wait(3000);
await click('.contribution-row', 1600);
await wait(2600);
await scrollTo('#modal .table-wrap', 800).catch(() => {});
await wait(2200);
await click('[data-action="close-modal"]', 1200);
await click('.contribution-row:nth-of-type(4)', 1400).catch(async () => {
  await page.evaluate(() => document.querySelectorAll('.contribution-row')[3].click());
  await wait(1200);
});
await wait(2200);
await page.evaluate(() => document.querySelector('#modal .unverified')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await wait(3400);

await cdp.send('Page.stopScreencast');
await browser.close();

const t0 = T0();
frames.forEach((f, i) => writeFileSync(join(OUT, `f${String(i).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64')));
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({
  frames: frames.map((f, i) => ({ i, t: +(f.t - t0).toFixed(3) })),
  steps: steps.map(s => ({ name: s.name, t: +(s.t - (steps[0].t - 0.7)).toFixed(3) })),
  duration: +(frames.at(-1).t - t0).toFixed(3),
}, null, 1));
console.log(`frames: ${frames.length}, duration: ${(frames.at(-1).t - t0).toFixed(1)}s`);
console.log(steps.map(s => s.name).join(' → '));
