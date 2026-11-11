import { test as base, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await use(page);
    expect(errors, '브라우저 console.error / pageerror').toEqual([]);
  },
});

async function call(request, path, key, method = 'GET', data, origin = '') {
  const res = await request.fetch(`${origin}/api${path}`, { method, headers: key ? { 'X-Key': key } : {}, data });
  expect(res.ok(), `${method} ${path}: ${res.status()}`).toBeTruthy();
  return res.json();
}
async function open(page, key, view = 'setup', origin = '') {
  await page.goto(`${origin}/#/join/${key}/${view}`);
  await expect(page.locator('#header-right')).not.toBeEmpty();
}
async function screenshot(page, info, name) {
  await mkdir('tools/out/e2e', { recursive: true });
  await page.screenshot({ path: `tools/out/e2e/${info.project.name}-${name}.png`, fullPage: true });
}

test('예시 기준 차단 → 규칙 초안 편집·확정 → 학생 확인 → 교수 잠금', async ({ page, request }, info) => {
  const c = await call(request, '/teams', null, 'POST', {
    course: '기준 흐름', name: '점검 팀', project: '기준 검증', deadline: '2099-12-31', members: [{ name: '가' }, { name: '나' }],
  });
  const id = c.team.id, p = c.prof_key;
  await open(page, p);
  await expect(page.getByRole('button', { name: '기준 잠그기', exact: true })).toBeDisabled();
  await open(page, c.team.members[0].key);
  await expect(page.getByRole('button', { name: '평가기준을 확인했습니다', exact: true })).toBeDisabled();
  await open(page, p);
  await page.locator('#rubric').fill('자료 작성 60%\n동료 검토 40%\n최종 발표는 별도 평가');
  await page.getByRole('button', { name: 'AI로 기준 항목 정리' }).click();
  await expect(page.locator('.crit-row')).toHaveCount(2);
  await expect(page.locator('#crit-editor')).toContainText('규칙으로 읽은 초안');
  // 초안은 DB를 변경하지 않는다.
  expect((await call(request, `/teams/${id}`, p)).criteria_meta.by).toBe('example');
  await page.getByRole('button', { name: '+ 항목 추가' }).click();
  await expect(page.locator('.crit-row')).toHaveCount(3);
  await page.locator('.crit-row').last().locator('[data-c=name]').fill('진행 관리');
  await page.locator('.crit-row').last().locator('[data-c=weight]').fill('10');
  await expect(page.locator('#w-sum')).toHaveText('합계 110%');
  await expect(page.locator('#w-sum')).toHaveClass('sum-bad');
  await page.getByRole('button', { name: '3번 항목 삭제', exact: true }).click();
  await expect(page.locator('.crit-row')).toHaveCount(2);
  await expect(page.locator('#w-sum')).toHaveText('합계 100%');
  await expect(page.locator('#w-sum')).toHaveClass('green');
  await screenshot(page, info, 'criteria');
  await page.getByRole('button', { name: '기준 확정', exact: true }).click();
  await expect.poll(async () => (await call(request, `/teams/${id}`, p)).criteria_meta.by).toBe('rule');
  for (const m of c.team.members) {
    await open(page, m.key);
    await page.getByRole('button', { name: '평가기준을 확인했습니다', exact: true }).click();
    await expect(page.getByRole('button', { name: '확인 완료', exact: true })).toBeDisabled();
  }
  await open(page, p);
  await page.getByRole('button', { name: '기준 잠그기', exact: true }).click();
  await expect(page.locator('.setup-banner')).toContainText('착수 설정이 완료되었습니다');
  expect((await call(request, `/teams/${id}`, p)).locked_at).toBeTruthy();
});

test('시연 리포트·활동·산식과 기록 조정·기준 밖 저장', async ({ page, request }, info) => {
  const c = await call(request, '/demo', null, 'POST');
  const id = c.team.id, p = c.prof_key;
  await open(page, p, 'report');
  await expect(page.locator('.chart-card')).toContainText('팀원별 기여율');
  await screenshot(page, info, 'report');
  await page.getByRole('button', { name: '산출 기준 보기' }).click();
  await expect(page.locator('#modal')).toContainText('기여율 산출 기준');
  await expect(page.locator('#modal')).toContainText('교수님 원문 기준 보기');
  await page.locator('#modal [data-action=close-modal]').first().click();
  await open(page, p, 'evidence');
  await expect(page.locator('.evidence-item')).toHaveCount(15);
  const item = page.locator('.evidence-item').first();
  const rid = await item.getAttribute('data-id');
  const records = await call(request, `/teams/${id}/records`, p);
  const original = records.find(r => String(r.id) === rid);
  await item.click();
  await page.locator('#record-type').selectOption(String((original.type + 1) % 4));
  await page.locator('#modal [data-action=save-record]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.locator(`.evidence-item[data-id="${rid}"]`).click();
  await expect(page.locator('#modal')).toContainText('교수 확인 전 원래 판단');
  await expect(page.locator('#modal')).toContainText(original.reason);
  await page.locator('#record-type').selectOption({ label: '기준 밖 (점수 제외)' });
  await page.locator('#modal [data-action=save-record]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.reload();
  await page.locator(`.evidence-item[data-id="${rid}"]`).click();
  await expect(page.locator('#record-type')).toHaveValue('');
  const saved = (await call(request, `/teams/${id}/records`, p)).find(r => String(r.id) === rid);
  expect(saved.type).toBeNull();
  expect(saved.orig_type).toBe(original.type);
  expect(saved.orig_reason).toBe(original.reason);
  expect(saved.orig_by).toBe(original.classified_by);
  await screenshot(page, info, 'record');
});

test('잘못된 임시 키: 요약·자기 기술 초안에 AI 호출 실패 배지', async ({ page, request }, info) => {
  const origin = 'http://127.0.0.1:4174';
  const c = await call(request, '/demo', null, 'POST', undefined, origin);
  const m = c.team.members[0];
  await open(page, m.key, 'statement', origin);
  await page.locator('[data-action=summary]').click();
  await expect(page.locator('.tag').filter({ hasText: '규칙 문장 · AI 호출 실패' })).toHaveCount(1);
  await page.locator('[data-action=draft]').click();
  await expect(page.locator('.tag').filter({ hasText: '규칙 문장 · AI 호출 실패' })).toHaveCount(2);
  const team = await call(request, `/teams/${c.team.id}`, m.key, 'GET', undefined, origin);
  expect(team.summaries[0].by).toBe('rule');
  expect(team.summaries[0].ai_error).toContain('401');
  expect(team.draft.by).toBe('rule');
  expect(team.draft.ai_error).toContain('401');
  await screenshot(page, info, 'ai-failure');
});
