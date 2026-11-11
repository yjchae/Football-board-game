// ─────────────────────────────────────────────
// QA 스모크 테스트: 실제 브라우저로 전체 게임 흐름을 한 바퀴 돈다.
// 실행: npm run build && npx vite preview --port 4173 & npm run e2e
// ─────────────────────────────────────────────
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 프로젝트에 playwright가 없으면 전역 설치본을 사용
const pw = await import('playwright').catch(() => {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(`${globalRoot}/playwright/index.js`).href);
});
const { chromium, devices } = pw.default ?? pw;

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function run(name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  // 킥오프 때 '전술 미작성' 확인창이 뜨면 그대로 진행
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] console: ${m.text()}`));

  // 빠른 테스트를 위해 중계 속도를 최소로
  await page.addInitScript(() => {
    if (!localStorage.getItem('card-football-v1')) {
      localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [], settings: { playbackMs: 40 } }, version: 0 }));
    }
  });
  await page.goto(URL);
  const shot = (n) => page.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: false });

  // 1) 연습용 팀 불러오기
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByText('번개 FC').first().waitFor();
  await shot('01-roster');

  // 2) 선수 등록 (수동 입력)
  await page.getByText('선수 등록').click();
  await page.getByPlaceholder('선수 이름').fill('테스트');
  await page.getByRole('button', { name: '저장' }).click();
  await page.getByText('테스트').first().waitFor();

  // 3) 포지션 배치 — 드래그앤드롭: 벤치의 '테스트'를 LB 자리로
  await page.getByText('포지션 배치').click();
  await shot('02-lineup-before');
  const chip = page.getByTestId('chip-테스트');
  const target = page.getByTestId('slot:df1');
  if (contextOptions.hasTouch) {
    // 터치 기기: "선수 탭 → 자리 탭" 방식
    await chip.tap();
    await target.tap();
  } else {
    // 데스크톱: 실제 마우스 드래그앤드롭 (대상이 화면 안에 보이도록 먼저 스크롤)
    await target.scrollIntoViewIfNeeded();
    const a = await chip.boundingBox();
    const b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  const inSlot = await page.getByTestId('slot:df1').getByTestId('chip-테스트').count();
  if (inSlot !== 1) throw new Error(`[${name}] 드래그앤드롭 실패`);
  await shot('03-lineup-after-drag');

  // 4) 경기 시작
  await page.getByRole('button', { name: /경기$/ }).click();
  await page.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await page.getByRole('button', { name: '🎉 킥오프!' }).click();
  await page.waitForTimeout(300);
  await shot('04-live');

  // 경기 중 작전타임 요청 → 교체 화면
  // (부상 이벤트가 나오면 자동으로 작전 타임이 걸릴 수도 있다)
  const resumeBtn = page.getByRole('button', { name: '▶ 경기 재개' });
  if (!(await resumeBtn.isVisible())) {
    // 그 사이 자동 작전 타임이 걸렸을 수 있으므로 실패해도 진행
    await page.getByRole('button', { name: /작전 타임 요청/ }).click({ timeout: 3000 }).catch(() => {});
  }
  // 작전 타임 또는 (마지막 구간에 요청했다면) 하프타임이 와야 한다
  for (let i = 0; i < 120; i++) {
    if ((await resumeBtn.isVisible()) || (await page.getByTestId('summary-1').isVisible())) break;
    await page.waitForTimeout(250);
  }
  if (await resumeBtn.isVisible()) {
    await shot('05-timeout');
    await resumeBtn.click();
  }

  // 5) 하프타임: 전반 정리 + 교체(탭 방식)
  for (let i = 0; i < 200 && !(await page.getByTestId('summary-1').isVisible()); i++) {
    if (await resumeBtn.isVisible()) await resumeBtn.click();
    await page.waitForTimeout(250);
  }
  await shot('06-halftime');
  const benchChip = page.getByTestId('bench').locator('.chip:not(.chip--disabled)').first();
  await benchChip.click();
  await page.getByTestId('slot:fw1').click();
  await page.getByText(/선수 교체:/).first().waitFor({ timeout: 3000 }).catch(() => {});
  await page.getByTestId('start-second-half').click();

  // 6) 경기 종료: 후반 정리 + 최종 결과
  // 부상으로 작전 타임이 걸리면 바로 재개하면서 종료까지 진행
  for (let i = 0; i < 200 && !(await page.getByTestId('final').isVisible()); i++) {
    if (await resumeBtn.isVisible()) await resumeBtn.click();
    await page.waitForTimeout(250);
  }
  await page.getByTestId('final').waitFor({ timeout: 5000 });
  await page.getByTestId('summary-2').waitFor();
  await shot('07-fulltime');
  const subLogged = await page.getByText(/선수 교체:/).count();
  console.log(`[${name}] 최종 점수: ${await page.getByTestId('final').locator('p').innerText()} | 교체기록 ${subLogged}건`);
  await context.close();
}

await run('desktop', { viewport: { width: 1280, height: 900 } });
await run('tablet', { ...devices['iPad (gen 7)'] });
await run('phone', { ...devices['iPhone 13'] });
await browser.close();

if (errors.length) {
  console.error('❌ 오류 발견:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('✅ E2E 스모크 테스트 통과');
