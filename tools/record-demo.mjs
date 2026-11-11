// node tools/record-demo.mjs [출력폴더] [--check]
// PNG + timeline.json만 생성한다. 영상 인코딩은 별도 Python 도구로 사람이 실행한다.
// --check는 주요 화면만 캡처하지만 동일한 UI 흐름을 끝까지 실행한다.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runDemo } from './demo-flow.mjs';
const out = process.argv.slice(2).find(a => a !== '--check') || 'tools/out/record';
const check = process.argv.includes('--check');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const frames = [], steps = [], writes = [];
const start = performance.now();
const now = () => +((performance.now() - start) / 1000).toFixed(3);
let cdp;
try {
  const page = await browser.newPage({ viewport: { width: 1344, height: 1008 }, deviceScaleFactor: 1 });
  if (!check) {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      const i = frames.length;
      frames.push({ i, t: now() });
      writes.push(writeFile(join(out, 'f' + String(i).padStart(6, '0') + '.png'), Buffer.from(data, 'base64')));
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1344, maxHeight: 1008, everyNthFrame: 1 });
  }
  await runDemo(page, {
    baseURL: process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000',
    pause: Number(process.env.DEMO_PAUSE_MS ?? (check ? 50 : 1200)),
    stage: async name => { steps.push({ name, t: now() }); },
    shot: async name => {
      if (check) {
        const i = frames.length;
        frames.push({ i, t: now() });
        await page.screenshot({ path: join(out, 'f' + String(i).padStart(6, '0') + '.png') });
      }
      console.log(name);
    },
  });
  if (cdp) await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  if (!frames.length) throw new Error('녹화 프레임이 없습니다.');
  await writeFile(join(out, 'timeline.json'), JSON.stringify({ frames, steps, duration: now(), mode: check ? 'check' : 'record' }, null, 2));
  console.log(frames.length + ' PNG 프레임 · ' + steps.map(s => s.name).join(' → '));
} finally { await browser.close(); }
