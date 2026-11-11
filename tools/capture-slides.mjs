// node tools/capture-slides.mjs [출력폴더] — 교수 기준 흐름 12장 캡처
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runDemo } from './demo-flow.mjs';
const out = process.argv[2] || 'tools/out/slides';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1344, height: 1008 }, deviceScaleFactor: 2 });
  await runDemo(page, {
    baseURL: process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000',
    pause: Number(process.env.DEMO_PAUSE_MS ?? 1200),
    shot: async name => { await page.screenshot({ path: join(out, name + '.png') }); console.log(name); },
  });
  console.log('12개 화면 캡처 · 시연용 팀 삭제');
} finally { await browser.close(); }
