import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumPDF } from './chromium-pdf.js';

const LEGACY = '이전 방식 기준(고정 3축) · 교수 기준 도입 전에 만든 팀';
test('기준 도입 전 팀은 화면·산출 모달에서 교수 확정으로 표시하지 않는다', async ({ page, request }) => {
  const res = await request.get('/api/teams/print-legacy-short', { headers: { 'X-Key': 'print-legacy-short' } });
  expect((await res.json()).criteria_meta.by).toBe('legacy');
  await page.goto('/#/join/print-legacy-short/report');
  await expect(page.locator('.scope-card')).toContainText(LEGACY);
  await expect(page.locator('.report-grid')).not.toContainText('교수님 평가기준');
  await page.getByRole('button', { name: '산출 기준 보기' }).click();
  await expect(page.locator('#modal')).toContainText(LEGACY);
  await expect(page.locator('#modal .modal-eyebrow')).not.toContainText('교수 평가기준');
  await expect(page.locator('#modal')).not.toContainText('AI 정리');
});

for (const variant of ['demo', 'legacy-short', 'legacy-long', 'legacy-no-review']) {
  test(`A4 리포트 페이지·꼬리 문구·PDF (${variant})`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'desktop', '실제 A4는 데스크톱 Chromium에서 출력');
    let key = `print-${variant}`;
    if (variant === 'demo') {
      const res = await request.post('/api/demo');
      key = (await res.json()).prof_key;
    }
    await page.goto(`/#/join/${key}/report`);
    await expect(page.locator('.contribution-row')).toHaveCount(4);
    if (variant === 'demo') await expect(page.locator('.scope-card')).toContainText('AI 정리 → 교수 확정');
    // 실제 PDF 내보내기와 같은 details 확장 경로를 실행하되 OS 인쇄창만 막는다.
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole('button', { name: 'PDF 내보내기' }).click();
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 794, height: 1123 });
    const blocks = await page.locator('.print-page').evaluateAll(nodes => nodes.map(n => ({
      height: n.getBoundingClientRect().height, text: n.innerText,
    })));
    expect(blocks).toHaveLength(variant === 'legacy-no-review' ? 5 : 6); // 팀 요약 + 학생 4명 + 확인 필요(있을 때)
    const a4 = (297 - 24) * 96 / 25.4;
    for (const block of blocks) {
      const overflow = block.height % a4;
      expect(block.height <= a4 || overflow >= a4 * .15, `근소한 넘침: ${block.height}px`).toBeTruthy();
    }
    await mkdir('tools/out/print', { recursive: true });
    const pdf = await page.pdf({ path: `tools/out/print/${variant}.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pages = chromiumPDF(pdf);
    expect(pages).toHaveLength(variant === 'legacy-long' ? 8 : variant === 'legacy-no-review' ? 5 : 6);
    const compact = text => text.replace(/\s/g, '');
    const full = compact(pages.map(p => p.text).join(''));
    expect(full).toContain(compact(variant === 'demo' ? 'AI 정리 → 교수 확정' : LEGACY));
    expect(full).toContain('표시가없다고AI를쓰지않았다는뜻은아닙니다');
    if (variant === 'demo') expect(full).toContain('구성한예시입니다');
    const students = await page.locator('.dossier .dossier-head h2').allTextContents();
    const starts = students.map(name => pages.findIndex(p => compact(p.text).startsWith(compact(name))));
    expect(starts.every(index => index > 0)).toBeTruthy();
    expect(new Set(starts).size).toBe(4);
    const flaggedStart = pages.findIndex(p => compact(p.text).startsWith('교수님이확인할기록'));
    expect(flaggedStart).toBe(variant === 'legacy-no-review' ? -1 : pages.length - 1);
    if (variant !== 'demo') {
      expect(full).not.toContain('교수님평가기준');
      expect(full).not.toContain('AI정리');
    }
    const foot = '동료 증언과 자기 기술은 검증되지 않은 참고 자료이며 기여율에 반영되지 않았습니다.';
    const tails = await page.locator('.dossier-foot').evaluateAll(nodes => nodes.map(n => n.previousElementSibling.textContent));
    const footerPages = pages.filter(p => compact(p.text).includes(compact(foot)));
    expect(footerPages).toHaveLength(4);
    footerPages.forEach((p, i) => expect(compact(p.text)).toContain(compact(tails[i])));
    // 원래 짧은 확인 필요 쪽은 허용하되, 빈 쪽·꼬리 한두 줄뿐인 쪽은 실패.
    for (const p of pages) { expect(p.text.length).toBeGreaterThan(80); expect(p.lines).toBeGreaterThanOrEqual(3); }
    if (variant === 'legacy-long') for (const p of pages.slice(2, 4)) {
      expect(p.text.length).toBeGreaterThan(150); expect(p.lines).toBeGreaterThanOrEqual(8);
    }
    await writeFile(`tools/out/print/${variant}-metrics.json`, JSON.stringify({ pageCount: pages.length, pages, blocks }, null, 2));
    await page.screenshot({ path: `tools/out/print/${variant}.png`, fullPage: true });
  });
}
