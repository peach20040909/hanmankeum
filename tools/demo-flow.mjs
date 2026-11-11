// 녹화와 슬라이드가 공유하는 실제 UI 흐름. 시연용 분류·프롬프트는 변경하지 않는다.
import { expect } from '@playwright/test';
export const SHOTS = [
  ['01_팀초대', 'invite'], ['02_도구연결', 'invite'],
  ['03_교수기준입력', 'criteria'], ['04_기준정리초안', 'criteria'], ['05_교수수정확정', 'criteria'],
  ['06_학생확인_기준잠금', 'lock'], ['07_기록수집_자동분류', 'collect'],
  ['08_확인필요', 'review'], ['09_분류판단비교', 'review'],
  ['10_기여도리포트', 'report'], ['11_산출기준', 'report'], ['12_원본기록_확인', 'report'],
];
export async function runDemo(page, { baseURL, shot, stage = async () => {}, pause = 1200 }) {
  const teams = [];
  const call = async (path, key, method = 'GET', data) => {
    const res = await page.request.fetch(baseURL + '/api' + path, { method, headers: key ? { 'X-Key': key } : {}, data });
    if (!res.ok()) throw new Error(method + ' ' + path + ': ' + res.status());
    return res.json();
  };
  const open = async (key, view = 'setup') => {
    await page.goto(baseURL + '/#/join/' + key + '/' + view);
    await expect(page.locator('#header-right')).not.toBeEmpty();
  };
  const frame = async (name, locator) => {
    if (locator) await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(pause);
    await shot(name);
  };
  const errors = [];
  const onError = e => errors.push(e.message);
  const onConsole = m => { if (m.type() === 'error') errors.push(m.text()); };
  page.on('pageerror', onError); page.on('console', onConsole);
  try {
    const c = await call('/teams', null, 'POST', {
      course: '캡스톤디자인(2)', name: '흐름 시연 팀', project: '교수 기준으로 기여 확인', deadline: '2099-12-31',
      repo: 'peach20040909/hanmankeum',
      members: [{ name: '박준호', github: 'peach20040909' }, { name: '김서연', github: 'seoyeon-kim' }],
    });
    teams.push(c);
    const id = c.team.id, p = c.prof_key;
    await stage('invite'); await open(p);
    await frame('01_팀초대', page.locator('.setup-step').nth(0));
    await frame('02_도구연결', page.locator('.setup-step').nth(1));
    await stage('criteria');
    await page.locator('#rubric').fill('기능 구현 40%\n품질 관리 20%\n문서화 15%\n프로젝트 관리 25%\n최종 발표는 별도 평가');
    await frame('03_교수기준입력', page.locator('#rubric'));
    await page.getByRole('button', { name: 'AI로 기준 항목 정리' }).click();
    await expect(page.locator('.crit-row')).toHaveCount(4, { timeout: 60_000 });
    await frame('04_기준정리초안', page.locator('.crit-row').first());
    const rows = page.locator('.crit-row');
    await rows.nth(1).locator('[data-c=weight]').fill('25');
    await rows.nth(3).locator('[data-c=weight]').fill('20');
    await rows.nth(1).locator('[data-c=desc]').fill('테스트·코드 리뷰·버그·화면 수정 포함');
    await rows.nth(1).locator('[data-c=keywords]').fill('테스트, 리뷰, 버그, 수정, fix');
    await rows.nth(2).locator('[data-kind="페이지 생성"]').check();
    await expect(page.locator('#w-sum')).toHaveText('합계 100%');
    await page.getByRole('button', { name: '기준 확정', exact: true }).click();
    await expect.poll(async () => (await call('/teams/' + id, p)).criteria_meta.by).not.toBe('example');
    await frame('05_교수수정확정', page.locator('#crit-editor'));
    await stage('lock');
    for (const m of c.team.members) {
      await open(m.key);
      await page.getByRole('button', { name: '평가기준을 확인했습니다', exact: true }).click();
      await expect(page.getByRole('button', { name: '확인 완료', exact: true })).toBeDisabled();
    }
    await open(p);
    await page.getByRole('button', { name: '기준 잠그기', exact: true }).click();
    await expect(page.locator('.setup-banner')).toContainText('착수 설정이 완료되었습니다');
    await frame('06_학생확인_기준잠금', page.locator('.setup-banner'));
    await stage('collect'); await open(p, 'evidence');
    const collected = page.waitForResponse(r => r.url().endsWith('/teams/' + id + '/collect') && r.request().method() === 'POST', { timeout: 180_000 });
    await page.getByRole('button', { name: 'GitHub 기록 수집', exact: true }).click();
    const result = await collected;
    if (!result.ok()) throw new Error('기록 수집 실패: ' + result.status());
    if ((await result.json()).team.record_count < 1) throw new Error('수집된 기록이 없습니다.');
    await expect(page.locator('.evidence-item').first()).toBeVisible();
    await frame('07_기록수집_자동분류', page.locator('.evidence-item').first());
    // 불일치는 실행마다 달라질 수 있어 예시 배너가 있는 시연 팀의 고정 2건을 사용한다.
    const demo = await call('/demo', null, 'POST'); teams.push(demo);
    await stage('review'); await open(demo.prof_key, 'evidence');
    await page.locator('[data-action=flag][data-flag=review]').click();
    await expect(page.locator('.evidence-item')).toHaveCount(2);
    await frame('08_확인필요', page.locator('.evidence-item').first());
    await page.locator('.evidence-item').first().click();
    await expect(page.locator('#modal .ai-compare')).toBeVisible();
    await frame('09_분류판단비교', page.locator('#modal .ai-compare'));
    await page.locator('#modal [data-action=close-modal]').first().click();
    await stage('report'); await open(demo.prof_key, 'report');
    await frame('10_기여도리포트', page.locator('.chart-card'));
    await page.getByRole('button', { name: '산출 기준 보기' }).click();
    await expect(page.locator('#modal')).toContainText('기여율 산출 기준');
    await frame('11_산출기준', page.locator('#modal .formula-box'));
    await page.locator('#modal [data-action=close-modal]').first().click();
    await page.locator('.contribution-row').first().click();
    await page.locator('#modal .evidence-item').first().click();
    await expect(page.locator('#record-type')).toBeVisible();
    await frame('12_원본기록_확인', page.locator('#modal .record-metadata'));
    expect(errors, '시연 중 브라우저 오류').toEqual([]);
  } finally {
    page.off('pageerror', onError); page.off('console', onConsole);
    for (const c of teams.reverse()) await call('/teams/' + c.team.id, c.prof_key, 'DELETE');
  }
}
