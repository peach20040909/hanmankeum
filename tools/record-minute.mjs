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
// 영상(1920×1080)을 화면으로 꽉 채운다. 120% 배율로 그려 실제 배치는 1600×900 이지만
// 글자는 1920 원본 해상도로 찍혀 선명하다. 확대용 스틸은 2배(3840×2160)로 따로 찍는다.
const VW = 1920, VH = 1080, PAGE_ZOOM = 1.2, DSF = 2;

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
const frames = [], writes = [], scenes = [], zooms = [], mouse = [], clicks = [];
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

  // 배율과 강조 테두리만 페이지에 넣는다. 마우스 포인터는 합성 단계에서 그린다
  // (페이지 안에 그리면 배율 때문에 위치가 어긋나고, 확대하면 같이 뭉개진다).
  await page.addInitScript(zoom => {
    const boot = () => {
      const s = document.createElement('style');
      s.textContent = `html{zoom:${zoom}} .__hl{outline:3px solid #4b7cf3!important;outline-offset:4px;border-radius:6px}`;
      document.head.appendChild(s);
    };
    document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
  }, PAGE_ZOOM);

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

  // ── 동작 도우미 (좌표는 모두 화면 px)
  let cx = VW * 0.55, cy = VH * 0.45;
  const moveTo = async (x, y) => {
    const dist = Math.hypot(x - cx, y - cy);
    const dur = Math.min(700, Math.max(260, dist * 0.6));
    mouse.push({ t: now(), x: Math.round(cx), y: Math.round(cy) });
    await wait(dur);
    await page.mouse.move(x, y);
    cx = x; cy = y;
    mouse.push({ t: now(), x: Math.round(x), y: Math.round(y) });
  };
  const center = async loc => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error('요소 위치를 찾지 못했습니다');
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const point = async loc => { const [x, y] = await center(loc); await moveTo(x, y); await wait(160); };
  const click = async loc => {
    await point(loc);
    clicks.push({ t: now(), x: Math.round(cx), y: Math.round(cy) });
    await page.mouse.down(); await wait(70); await page.mouse.up();
  };
  const box = async (loc, pad = 14) => {
    const b = await loc.boundingBox();
    return [Math.max(0, b.x - pad), Math.max(0, b.y - pad), b.width + pad * 2, b.height + pad * 2].map(Math.round);
  };
  // 확대 구간 기록: 합성 단계가 이 상자를 화면에 맞춰 키운다.
  // screencast 프레임은 1배로 오므로, 확대해 멈춰 있는 동안 쓸 2배 스틸을 따로 찍는다.
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
  const union = (a, b) => {
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
    return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
  };
  const highlight = (loc, on = true) => loc.evaluate((el, on) => el.classList.toggle('__hl', on), on);
  const snap = async n => { if (probe) await page.screenshot({ path: join(OUT, `probe-${n}.png`), scale: 'css' }); };
  const scene = async (n, fn) => {
    const start = now();
    scenes.push({ n, t0: start });
    await fn();
    const target = start + SCENES[n - 1];
    if (!probe && now() < target) await wait((target - now()) * 1000);
    scenes.at(-1).t1 = now();
    await snap(n);
    console.log(`장면 ${n}: ${(scenes.at(-1).t1 - start).toFixed(1)}초`);
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
  await page.mouse.move(cx, cy);
  mouse.push({ t: now(), x: Math.round(cx), y: Math.round(cy) });

  // 1. 교수님이 확정한 평가기준
  await scene(1, async () => {
    await wait(1600);
    const card = page.locator('.scope-card');
    await card.scrollIntoViewIfNeeded();
    await point(card.locator('.mrl-tag'));
    await highlight(card);
    await zoom(card, 6000, 16);
    await highlight(card, false);
  });

  // 2. 확인 필요 필터
  await scene(2, async () => {
    await click(page.locator('.nav-item', { hasText: '활동 근거' }));
    await ready();
    await page.evaluate(() => scrollTo(0, 0));
    await wait(400);
    await click(page.locator('[data-action=flag][data-flag=review]'));
    await page.locator('.evidence-item').nth(1).waitFor();
    if (await page.locator('.evidence-item').count() !== 2) throw new Error('확인 필요가 2건이 아닙니다');
    await wait(300);
    await zoom(page.locator('.evidence-list'), 3600, 18);
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
    await zoomBox(union(await box(cmp, 12), await box(modal.locator('.explain-card').first(), 12)), 4000);
  });

  // 4. 원본을 보고 교수가 결정 (원본 링크는 강조만, 새 탭 X)
  await scene(4, async () => {
    const link = modal.locator('.record-metadata a');
    await link.scrollIntoViewIfNeeded();
    await point(link);
    await highlight(link);
    await zoom(modal.locator('.record-metadata'), 2500, 14);
    await highlight(link, false);
    const sel = modal.locator('#record-type');
    await sel.scrollIntoViewIfNeeded();
    await point(sel);
    clicks.push({ t: now(), x: Math.round(cx), y: Math.round(cy) });
    // 헤드리스에선 기본 드롭다운 목록이 화면에 그려지지 않아 값만 바뀌어 보인다.
    // 원본을 보니 배포 설정이 아니라 오류 수정 → 품질 관리
    await sel.selectOption({ label: '품질 관리' });
    await highlight(sel);
    await zoom(sel, 2200, 40);
    await highlight(sel, false);
  });

  // 5. 저장 → 다시 열어 '교수 확인 전 원래 판단' 확인
  await scene(5, async () => {
    await click(modal.locator('[data-action=save-record]'));
    await modal.waitFor({ state: 'hidden' });
    await wait(350);
    await click(page.locator('[data-action=flag][data-flag=all]'));
    await wait(300);
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

  // 7. 자기 기술 · 동료 증언은 수치와 분리 (화면 제목은 '본인 기술')
  await scene(7, async () => {
    await click(page.locator('.contribution-row', { hasText: '최민재' }));
    await modal.waitFor();
    await wait(500);
    const self = modal.locator('.detail-section-title', { hasText: '본인 기술' });
    const peer = modal.locator('.unverified');
    await self.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await modal.evaluate(el => el.scrollBy(0, -24));
    await wait(400);
    await point(self);
    await zoomBox(union(await box(self, 12), await box(peer, 12)), 3000);
  });

  // 8. 기여율과 근거를 함께 — 인쇄용 학생 소명 쪽을 가로로 꽉 채워 확대한 뒤 아래로 훑는다
  await scene(8, async () => {
    await click(modal.locator('[data-action=close-modal]').first());
    await modal.waitFor({ state: 'hidden' });
    await moveTo(VW - 60, VH - 60);
    await page.emulateMedia({ media: 'print' });
    await wait(500);
    const dossier = page.locator('.dossier').filter({ has: page.locator('.dossier-table') }).first();
    await dossier.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => scrollBy(0, -20));
    await wait(600);
    // 소명 쪽만 2배로 잘라 찍는다. 화면 밖으로 이어지는 부분까지 담아야 아래로 훑을 수 있다.
    // 페이지 기준 위치 = 화면 위치 − 문서 맨 위의 화면 위치 (배율이 걸려도 같은 단위)
    const db = await dossier.boundingBox();
    const hb = await page.locator('html').boundingBox();
    const z = { t0: now(), pan: true, box: [db.x - 14, db.y - 14, db.width + 28, db.height + 28].map(Math.round) };
    zooms.push(z);
    if (!probe) {
      z.still = 'still-pan.png';
      await page.screenshot({ path: join(OUT, z.still), fullPage: true,
        clip: { x: Math.max(0, db.x - 14), y: Math.max(0, db.y - hb.y - 14), width: db.width + 28, height: db.height + 28 } });
    }
    const left = 6400 - (now() - z.t0) * 1000;
    if (left > 0) await wait(left);
    z.t1 = now();
  });

  if (cdp) await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ viewport: [VW, VH], dsf: DSF, frames, scenes, zooms, mouse, clicks, duration: now() }, null, 2));
  console.log(probe ? '점검 PNG 저장' : `${frames.length} 프레임 · ${now().toFixed(1)}초`);
} finally {
  if (team) {
    try { await api('/teams/' + team.team.id, team.prof_key, 'DELETE'); console.log('시연 팀 삭제 완료'); }
    catch (e) { console.log('시연 팀 삭제 실패: ' + e.message); }
  }
  await browser.close();
  console.log(errors.length ? '브라우저 오류:\n' + errors.join('\n') : '브라우저 오류 없음');
}
