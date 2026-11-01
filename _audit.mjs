import puppeteer from 'puppeteer-core';
const B = 'http://127.0.0.1:3200', OUT = process.argv[2];
const api = async (p, key, m='GET', body) => {
  const r = await fetch(`${B}/api${p}`, { method: m, headers: { 'Content-Type':'application/json', ...(key?{'X-Key':key}:{}) }, body: body && JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${d.error}`); return d;
};
// 시연 팀(마감) + 진행 중 팀(착수 설정) 두 개
const demo = await api('/demo', null, 'POST');
const live = await api('/teams', null, 'POST', { course: '캡스톤디자인(2)', name: '팀 5', project: '교내 중고장터 앱',
  start_date: '2026-09-01', deadline: '2027-01-10', members: [{ name:'김효준', role:'기획' }, { name:'박서준', role:'개발' }, { name:'장민준', role:'디자인' }] });
const LT = live.team.id, LP = live.prof_key, LK = live.team.members.map(m=>m.key);

const br = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--hide-scrollbars'] });
const p = await br.newPage();
await p.setViewport({ width: 1340, height: 950, deviceScaleFactor: 1 });
const go = async (key, view) => { await p.goto(`${B}/#/join/${key}${view?'/'+view:''}`, { waitUntil:'networkidle0' }); await new Promise(r=>setTimeout(r,1400)); };
const snap = async n => { await p.screenshot({ path:`${OUT}/${n}.png`, fullPage:true }); console.log('✓', n); };

await go(LP, 'setup');        await snap('a1_착수설정_교수');
await go(LK[0], 'setup');     await snap('a2_착수설정_학생');
await p.goto(`${B}/#/`, { waitUntil:'networkidle0' }); await new Promise(r=>setTimeout(r,1200)); await snap('a3_홈_팀목록');
// 마감 처리 후 동료평가 제출 전 화면
for (const k of LK) await api(`/teams/${LT}/confirm`, k, 'POST');
await api(`/teams/${LT}/lock`, LP, 'POST');
await api(`/teams/${LT}/close`, LP, 'POST');
await go(LK[0], 'peer');      await snap('a4_동료평가_제출전');
// 모달들 (시연 팀)
await go(demo.prof_key, 'report');
await p.evaluate(() => document.querySelector('.contribution-row').click());
await new Promise(r=>setTimeout(r,1400)); await snap('a5_개인기여상세_모달');
await p.evaluate(() => document.querySelector('[data-action="close-modal"]').click());
await new Promise(r=>setTimeout(r,600));
await p.evaluate(() => document.querySelector('[data-action="method"]').click());
await new Promise(r=>setTimeout(r,1400)); await snap('a6_산출기준_모달');
await br.close();
