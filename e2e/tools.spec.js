import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';

const exec = promisify(execFile);
test('시연 녹화·슬라이드·정지 캡처 도구가 교수 기준 흐름을 끝까지 실행한다', async ({ baseURL }) => {
  test.setTimeout(120_000);
  const env = { ...process.env, DEMO_BASE_URL: baseURL, DEMO_PAUSE_MS: '50' };
  // 실제 CDP 프레임 수집까지 실행한다. MP4/GIF는 만들지 않는다.
  await exec(process.execPath, ['tools/record-demo.mjs', 'tools/out/smoke/record'], { env, timeout: 60_000 });
  const timeline = JSON.parse(await readFile('tools/out/smoke/record/timeline.json', 'utf8'));
  expect(timeline.mode).toBe('record');
  expect(timeline.steps.map(s => s.name)).toEqual(['invite', 'criteria', 'lock', 'collect', 'review', 'report']);
  expect(timeline.frames.length).toBeGreaterThan(12);
  expect(timeline.frames.every((f, i, all) => i === 0 || f.t >= all[i - 1].t)).toBeTruthy();
  expect(timeline.duration).toBeGreaterThan(timeline.frames.at(-1).t);
  for (const tool of ['capture-slides', 'capture-demo']) {
    const folder = `tools/out/smoke/${tool}`;
    await exec(process.execPath, [`tools/${tool}.mjs`, folder], { env, timeout: 60_000 });
    expect((await readdir(folder)).filter(n => n.endsWith('.png'))).toHaveLength(12);
    const image = await readFile(`${folder}/03_교수기준입력.png`);
    expect(image.readUInt32BE(16)).toBe(2688);
    expect(image.readUInt32BE(20)).toBe(2016);
    await readFile(`${folder}/12_원본기록_확인.png`);
  }
});
