import puppeteer from 'puppeteer-core';
const B = 'http://127.0.0.1:3190', OUT = process.argv[2];
const api = async (p, key, m = 'GET', body) => {
  const r = await fetch(`${B}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body && JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${d.error}`); return d;
};
const demo = await api('/demo', null, 'POST');
const P = demo.prof_key, T = demo.team.id;
const full = await api(`/teams/${T}`, P);
const seo = full.members[1];
await api(`/teams/${T}/members/${seo.id}/summary`, seo.key, 'POST').catch(e => console.log('summary:', e.message));

const br = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const p = await br.newPage();
await p.setViewport({ width: 1080, height: 811, deviceScaleFactor: 2 });
const go = async (key, view) => { await p.goto(`${B}/#/join/${key}${view ? '/' + view : ''}`, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 1600)); };
// 카드 '사이'에서 끊기도록: 대상 카드의 위쪽이 헤더 바로 아래에 오게 맞춘다
const frame = async (sel) => p.evaluate(s => {
  const el = document.querySelector(s); if (!el) return 'missing';
  const head = document.querySelector('.app-header');
  const gap = (head ? head.getBoundingClientRect().height : 70) + 14;
  window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - gap, behavior: 'instant' });
  return 'ok';
}, sel);
const shot = async (name, sel) => {
  if (sel) console.log(' ', sel, await frame(sel));
  await new Promise(r => setTimeout(r, 800));
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✓', name);
};

await go(P, 'evidence');   await shot('08_기록수집_자동분류', '.card-pad');
await go(P, 'report');     await shot('09_AI_검증장치', '.ai-work');
await go(P, 'report');     await shot('10_기여도_리포트', '.chart-card');
await go(seo.key, 'statement'); await shot('11_학생이_AI를_검증한다', '.card-pad');
await br.close();
