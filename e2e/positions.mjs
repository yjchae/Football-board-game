// ─────────────────────────────────────────────
// QA: 자유 위치 드래그 + 사진 속 카드 배치대로 포지션 정하기
// 실행: npm run build && npx vite preview --port 4173 & node e2e/positions.mjs
// ─────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pw = await import('playwright').catch(() => {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(`${globalRoot}/playwright/index.js`).href);
});
const { chromium, devices } = pw.default ?? pw;

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
const check = (ok, label) => results.push([Boolean(ok), label]);
const slotPos = (page, slotId) =>
  page.getByTestId(`slot:${slotId}`).evaluate((el) => ({ left: el.style.left, top: el.style.top }));

// ─────────────── 1) 데스크톱: 빈 잔디로 드래그 ───────────────
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', (e) => check(false, `페이지 오류: ${e.message}`));
  await page.goto(URL);
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByText('포지션 배치').click();
  await page.getByTestId('pitch').scrollIntoViewIfNeeded();
  const before = await page.getByTestId('shape').innerText();

  // 왼쪽 수비수(df1)를 공격수 줄과 미드필더 줄 사이 빈 곳(x 50%, y 32%)으로
  const chip = page.getByTestId('slot:df1').locator('.chip');
  const a = await chip.boundingBox();
  const pitch = await page.getByTestId('pitch').boundingBox();
  const tx = pitch.x + pitch.width * 0.5;
  const ty = pitch.y + pitch.height * 0.32;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const pos = await slotPos(page, 'df1');
  const after = await page.getByTestId('shape').innerText();
  check(Math.abs(parseFloat(pos.left) - 50) <= 4 && Math.abs(parseFloat(pos.top) - 32) <= 4, `빈 잔디로 드래그 → 놓은 위치로 이동 (left ${pos.left}, top ${pos.top})`);
  check(before.includes('4-3-3') && after.includes('3-3-4'), `위치에 따라 모양 변경: ${before} → ${after}`);
  await page.screenshot({ path: `${OUT}/positions-free-drag.png` });

  // 기본 위치로 되돌리기
  await page.getByText('↺ 기본 위치로').click();
  check((await page.getByTestId('shape').innerText()).includes('4-3-3'), '기본 위치로 되돌리기');

  // 저장 유지 (새로고침 후에도 옮긴 위치가 남아 있는지)
  const chip2 = page.getByTestId('slot:mf2').locator('.chip');
  const b = await chip2.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 8, b.y + 28, { steps: 3 });
  await page.mouse.move(pitch.x + pitch.width * 0.2, pitch.y + pitch.height * 0.3, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = await slotPos(page, 'mf2');
  await page.reload();
  await page.getByText('포지션 배치').click();
  const reloaded = await slotPos(page, 'mf2');
  check(moved.left === reloaded.left && moved.top === reloaded.top, `새로고침 후에도 위치 유지 (${reloaded.left}, ${reloaded.top})`);
  await page.context().close();
}

// ─────────────── 2) 태블릿: 탭 → 빈 잔디 탭 ───────────────
{
  const page = await (await browser.newContext({ ...devices['iPad (gen 7)'] })).newPage();
  await page.goto(URL);
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByText('포지션 배치').click();
  await page.getByTestId('slot:fw2').locator('.chip').tap();
  const pitch = await page.getByTestId('pitch').boundingBox();
  await page.touchscreen.tap(pitch.x + pitch.width * 0.3, pitch.y + pitch.height * 0.33);
  await page.waitForTimeout(300);
  const pos = await slotPos(page, 'fw2');
  check(Math.abs(parseFloat(pos.top) - 33) <= 4, `터치: 선수 탭 → 빈 잔디 탭으로 이동 (top ${pos.top})`);
  await page.context().close();
}

// ─────────────── 3) 사진 속 4-3-3 배치 → 포지션 ───────────────
{
  // 거꾸로 찍은 사진: 골키퍼 카드가 사진 "위쪽"
  const layout = [
    ['골키', 'GK', 'GK', 50, 8],
    ['왼수', 'LB', 'DF', 85, 30], ['중수1', 'CB', 'DF', 62, 28], ['중수2', 'CB', 'DF', 38, 28], ['오수', 'RB', 'DF', 15, 30],
    ['미드1', 'CM', 'MF', 72, 52], ['미드2', 'CM', 'MF', 50, 50], ['미드3', 'CM', 'MF', 28, 52],
    ['왼공', 'LW', 'FW', 80, 80], ['센공', 'ST', 'FW', 50, 85], ['오공', 'RW', 'FW', 20, 80],
  ];
  const W = 1000, H = 1300, CW = 120, CH = 160;
  const painter = await browser.newPage({ viewport: { width: W, height: H } });
  await painter.setContent(`<body style="margin:0;width:${W}px;height:${H}px;background:#6b4a2c;position:relative;font-family:sans-serif">
    ${layout.map(([n, pos, , x, y]) => `<div style="position:absolute;left:${(x / 100) * W - CW / 2}px;top:${(y / 100) * H - CH / 2}px;width:${CW}px;height:${CH}px;border-radius:10px;background:#e9c96a;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:22px"><b>${pos}</b>${n}</div>`).join('')}
  </body>`);
  const photo = await painter.screenshot({ type: 'jpeg' });
  await painter.close();

  const cards = layout.map(([name, position, role, x, y], i) => ({
    name, number: i + 1, position, role, overall: 70 + i,
    stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
    box: [Math.round(((y / 100) * H - CH / 2) / H * 1000), Math.round(((x / 100) * W - CW / 2) / W * 1000), Math.round(((y / 100) * H + CH / 2) / H * 1000), Math.round(((x / 100) * W + CW / 2) / W * 1000)],
  }));

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', (e) => check(false, `페이지 오류: ${e.message}`));
  await page.addInitScript(() =>
    localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [], settings: { engine: 'gemini', geminiKey: 'k' } }, version: 0 })),
  );
  await page.route('**/generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ cards }) }] }, finishReason: 'STOP' }] }),
    }),
  );
  await page.goto(URL);
  await page.getByRole('button', { name: '＋ 새 팀 만들기' }).click();
  await page.getByPlaceholder('예: 우리반 FC').fill('사진 FC');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.getByText('팀 등록').first().click();
  await page.getByTestId('team-album').setInputFiles({ name: 'formation.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByTestId('mini-pitch').waitFor({ timeout: 15000 });
  const photoOn = await page.getByTestId('place-photo').evaluate((el) => el.classList.contains('on'));
  const previewText = await page.locator('.placement__preview').innerText();
  check(photoOn, '사진 한 장 + 카드 11장 → "사진 배치대로"가 기본 선택');
  check(previewText.includes('4-3-3'), '거꾸로 찍은 사진도 미리보기 모양 4-3-3');
  await page.screenshot({ path: `${OUT}/positions-photo-preview.png` });

  await page.getByTestId('bulk-save').click();
  await page.getByText('포지션 배치').click();
  const shape = await page.getByTestId('shape').innerText();
  const gk = await page.getByTestId('slot:gk').innerText();
  check(shape.includes('4-3-3'), `등록 후 포지션 배치 화면 모양 ${shape}`);
  check(gk.includes('골키'), '골키퍼 카드가 골키퍼 자리에');
  // 사진 속 왼쪽 수비 카드(거꾸로 찍어서 사진 오른쪽에 있던 "왼수")가 경기장 왼쪽에 서야 한다
  const leftBack = await page.getByTestId('chip-왼수').evaluate((el) => parseFloat(el.closest('.slot').style.left));
  check(leftBack < 30, `"왼수" 카드가 경기장 왼쪽에 (x ${leftBack}%)`);
  await page.screenshot({ path: `${OUT}/positions-photo-lineup.png` });
  await page.context().close();
}

await browser.close();
let failed = false;
for (const [ok, label] of results) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
