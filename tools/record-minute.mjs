// 결선용 1분 시연 녹화 — 배포 사이트를 그대로 찍는다.
//   node tools/record-minute.mjs            → tools/out/minute/frames + timeline.json
//   node tools/record-minute.mjs --probe    → 장면마다 PNG 한 장만 (흐름 점검용)
// 영상 합성은 tools/compose-minute.py 가 한다.
//
// 지키는 것
// - 시연 팀은 POST /api/demo 로 새로 만들고 끝나면 DELETE 한다. 기존 시연 팀은 건드리지 않는다.
// - 'GitHub 기록 수집'은 누르지 않는다. 원본 링크는 강조만 하고 열지 않는다.
// - 교수 키는 파일·로그에 남기지 않는다. 페이지 영역만 찍으므로 주소창도 나오지 않는다.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.DEMO_BASE_URL || 'https://hanmankeum.vercel.app';
const OUT = 'tools/out/minute';
const FRAMES = join(OUT, 'frames');
const probe = process.argv.includes('--probe');
const VW = 1344, VH = 1008, DSF = 2;   // 스틸 스크린샷이 2배로 찍힌다 (screencast 는 1배)

// 장면 목표 길이(초). 동작이 끝나면 남은 시간만큼 그대로 보여 준다.
const SCENES = [10, 8, 7, 8, 7, 6, 6, 8];

await rm(OUT, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const api = async (path, key, method = 'GET') => {
  const res = await fetch(BASE + '/api' + path, { method, headers: key ? { 'X-Key': key } : {} });
  if (!res.ok) throw new Error(`${method} /api${path} → ${res.status}`);
  return res.json();
};

const browser = await chromium.launch();
const errors = [];
const frames = [], writes = [], scenes = [], zooms = [];
let team = null, cdp = null;
const t0 = performance.now();
const now = () => +((performance.now() - t0) / 1000).toFixed(3);
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  team = await api('/demo', null, 'POST');
  const K = team.prof_key;
  console.log(`시연 팀 생성 (확인 필요 ${team.team.needs_review}건)`);

  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // 헤드리스 화면에는 마우스 포인터가 찍히지 않는다 → 페이지 위에 보이는 포인터를 그린다
  await page.addInitScript(() => {
    const css = `#__cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
      transform:translate(-3px,-2px);transition:opacity .2s}
      #__cur svg{width:26px;height:26px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .__ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
      border:3px solid #4b7cf3;z-index:2147483646;pointer-events:none;animation:__r .55s ease-out forwards}
      @keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
      .__hl{outline:3px solid #4b7cf3!important;outline-offset:4px;border-radius:6px;transition:outline-color .2s}`;
    const boot = () => {
      if (document.getElementById('__cur')) return;
      const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
      const c = document.createElement('div'); c.id = '__cur';
      c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      c.style.left = (window.__cx ?? 680) + 'px'; c.style.top = (window.__cy ?? 520) + 'px';
      document.body.appendChild(c);
      addEventListener('mousemove', e => { window.__cx = e.clientX; window.__cy = e.clientY; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
      addEventListener('mousedown', e => {
        const r = document.createElement('div'); r.className = '__ring';
        r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
        document.body.appendChild(r); setTimeout(() => r.remove(), 600);
      }, true);
    };
    document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
  });

  if (!probe) {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      const i = frames.length;
      frames.push({ i, t: now() });
      writes.push(writeFile(join(FRAMES, `f${String(i).padStart(6, '0')}.jpg`), Buffer.from(data, 'base64')));
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
  }

  // ── 동작 도우미
  let cx = VW / 2, cy = VH / 2;
  const moveTo = async (x, y, steps = 14) => { await page.mouse.move(x, y, { steps }); cx = x; cy = y; };
  const center = async loc => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error('요소 위치를 찾지 못했습니다');
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const point = async loc => { const [x, y] = await center(loc); await moveTo(x, y); await wait(180); };
  const click = async loc => { await point(loc); await page.mouse.down(); await wait(70); await page.mouse.up(); };
  const box = async (loc, pad = 14) => {
    const b = await loc.boundingBox();
    return [Math.max(0, b.x - pad), Math.max(0, b.y - pad), b.width + pad * 2, b.height + pad * 2].map(Math.round);
  };
  // 확대 구간 기록: 합성 단계가 이 상자를 화면에 맞춰 키운다 (CSS px 기준).
  // screencast 프레임은 기기 배율을 무시하고 1배로 온다 → 확대해 멈춰 있는 동안 쓸
  // 2배 해상도 스틸을 따로 찍어 둔다 (글자가 뭉개지지 않게).
  const zoomBox = async (b, holdMs) => {
    const z = { t0: now(), box: b };
    zooms.push(z);
    if (!probe) {
      z.still = `still-${String(zooms.length).padStart(2, '0')}.png`;
      await page.screenshot({ path: join(OUT, z.still) });
    }
    const left = holdMs - (now() - z.t0) * 1000;
    if (left > 0) await wait(left);
    z.t1 = now();
  };
  const zoom = async (loc, holdMs, pad) => zoomBox(await box(loc, pad), holdMs);
  const highlight = (loc, on = true) => loc.evaluate((el, on) => el.classList.toggle('__hl', on), on);
  const snap = async n => { if (probe) await page.screenshot({ path: join(OUT, `probe-${n}.png`) }); };
  let sceneStart = 0;
  const scene = async (n, fn) => {
    sceneStart = now();
    scenes.push({ n, t0: sceneStart });
    await fn();
    const target = sceneStart + SCENES[n - 1];
    if (!probe && now() < target) await wait((target - now()) * 1000);
    scenes[scenes.length - 1].t1 = now();
    await snap(n);
    console.log(`장면 ${n}: ${(scenes.at(-1).t1 - scenes.at(-1).t0).toFixed(1)}초`);
  };
  const ready = async () => {
    await page.locator('#header-right').filter({ hasNotText: /^$/ }).waitFor();
    await page.locator('.main .card').first().waitFor();
    await wait(350);
  };
  const modal = page.locator('#modal');
  const FIX = 'fix: app.js → handler.js';

  // 녹화 시작 전에 리포트를 띄워 둔다 (첫 프레임부터 화면이 차 있도록)
  await page.goto(`${BASE}/#/join/${K}/report`);
  await ready();
  await moveTo(700, 420, 1);

  // 1. 교수님이 확정한 평가기준
  await scene(1, async () => {
    await wait(1600);
    const card = page.locator('.scope-card');
    await card.scrollIntoViewIfNeeded();
    await point(card.locator('h2'));
    await highlight(card);
    await zoom(card, 6200, 16);
    await highlight(card, false);
  });

  // 2. 확인 필요 필터
  await scene(2, async () => {
    await click(page.locator('.nav-item', { hasText: '활동 근거' }));
    await ready();
    await page.evaluate(() => scrollTo(0, 0));
    await wait(500);
    await click(page.locator('[data-action=flag][data-flag=review]'));
    await page.locator('.evidence-item').nth(1).waitFor();
    if (await page.locator('.evidence-item').count() !== 2) throw new Error('확인 필요가 2건이 아닙니다');
    await wait(300);
    await zoom(page.locator('.evidence-list'), 3800, 18);
  });

  // 3. AI 판단 · 규칙 판단 · 이유
  await scene(3, async () => {
    await click(page.locator('.evidence-item', { hasText: FIX }));
    await modal.locator('.ai-compare').waitFor();
    await wait(600);
    const cmp = modal.locator('.ai-compare');
    await cmp.scrollIntoViewIfNeeded();
    await point(cmp);
    // 비교 상자와 바로 아래 '이 기록이 근거가 된 이유'를 한 화면에
    const a = await box(cmp, 12), b = await box(modal.locator('.explain-card').first(), 12);
    await zoomBox([Math.min(a[0], b[0]), a[1], Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]), b[1] + b[3] - a[1]], 4200);
  });

  // 4. 원본을 보고 교수가 결정 (원본 링크는 강조만, 새 탭 X)
  await scene(4, async () => {
    const link = modal.locator('.record-metadata a');
    await link.scrollIntoViewIfNeeded();
    await point(link);
    await highlight(link);
    await zoom(modal.locator('.record-metadata'), 2600, 14);
    await highlight(link, false);
    const sel = modal.locator('#record-type');
    await sel.scrollIntoViewIfNeeded();
    await point(sel);
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.press('Escape').catch(() => {});
    // 원본을 보니 배포 설정이 아니라 오류 수정 → 품질 관리
    await sel.selectOption({ label: '품질 관리' });
    await highlight(sel);
    await zoom(sel, 2200, 40);
    await highlight(sel, false);
  });

  // 5. 저장 → 다시 열어 '교수 확인 전 원래 판단' 확인
  await scene(5, async () => {
    const save = modal.locator('[data-action=save-record]');
    await click(save);
    await modal.waitFor({ state: 'hidden' });
    await wait(400);
    await click(page.locator('[data-action=flag][data-flag=all]'));
    await wait(350);
    await click(page.locator('.evidence-item', { hasText: FIX }));
    const orig = modal.locator('.explain-card');
    await orig.waitFor();
    await orig.scrollIntoViewIfNeeded();
    await wait(300);
    await point(orig);
    await zoom(orig, 1900, 14);
  });

  // 6. 온라인 기록 0% ≠ 기여 0%
  await scene(6, async () => {
    await click(modal.locator('[data-action=close-modal]').first());
    await modal.waitFor({ state: 'hidden' });
    await click(page.locator('.nav-item', { hasText: '기여도 리포트' }));
    await ready();
    const row = page.locator('.contribution-row', { hasText: '최민재' });
    await row.scrollIntoViewIfNeeded();
    await wait(300);
    await point(row);
    await highlight(row);
    await zoom(row, 2100, 18);
    await highlight(row, false);
  });

  // 7. 자기 기술 · 동료 증언은 수치와 분리
  await scene(7, async () => {
    await click(page.locator('.contribution-row', { hasText: '최민재' }));
    await modal.waitFor();
    await wait(500);
    // 화면의 제목은 '본인 기술'. 본인 기술부터 동료 증언까지 한 번에 보이게 내린다
    const self = modal.locator('.detail-section-title', { hasText: '본인 기술' });
    const peer = modal.locator('.unverified');
    await self.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await modal.evaluate(el => el.scrollBy(0, -24));
    await wait(400);
    await point(self);
    const a = await box(self, 12), b = await box(peer, 12);
    await zoomBox([Math.min(a[0], b[0]), a[1], Math.max(a[2], b[2]), b[1] + b[3] - a[1]], 3000);
  });

  // 8. 기여율과 근거를 함께 — 인쇄용 학생 소명 쪽
  await scene(8, async () => {
    await click(modal.locator('[data-action=close-modal]').first());
    await modal.waitFor({ state: 'hidden' });
    await moveTo(VW - 40, VH - 40, 8);
    await page.emulateMedia({ media: 'print' });
    await wait(500);
    const dossier = page.locator('.dossier').filter({ has: page.locator('.dossier-table') }).first();
    await dossier.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, -30));
    await wait(600);
    await zoom(dossier, 5200, 10);
  });

  if (cdp) await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ viewport: [VW, VH], dsf: DSF, frames, scenes, zooms, duration: now() }, null, 2));
  console.log(probe ? '점검 PNG 저장' : `${frames.length} 프레임 · ${now().toFixed(1)}초`);
} finally {
  if (team) {
    try { await api('/teams/' + team.team.id, team.prof_key, 'DELETE'); console.log('시연 팀 삭제 완료'); }
    catch (e) { console.log('시연 팀 삭제 실패: ' + e.message); }
  }
  await browser.close();
  console.log(errors.length ? '브라우저 오류:\n' + errors.join('\n') : '브라우저 오류 없음');
}
