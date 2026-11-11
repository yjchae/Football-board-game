// ─────────────────────────────────────────────
// QA 회귀 테스트: QA 1~3회차에서 찾은 결함이 다시 생기지 않는지 확인
// 실행: npm run build && npx vite preview --port 4173 & node e2e/qa-regression.mjs
// ─────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const pw = await import('playwright').catch(() => {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(`${globalRoot}/playwright/index.js`).href);
});
const { chromium } = pw.default ?? pw;
const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const b = await chromium.launch();
const results = [];
const check = (ok, label) => results.push([Boolean(ok), label]);
const FAST = () => localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [], settings: { playbackMs: 40 } }, version: 0 }));

// ─────────────── Q1: 후반 시작 연타 / Q3: 킥오프 전 교체 ───────────────
{
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
  await p.addInitScript(FAST);
  await p.goto(URL);
  await p.getByText('연습용 팀 2개 불러오기').click();
  await p.getByRole('button', { name: /경기$/ }).click();
  await p.getByRole('button', { name: '⚽ 경기 시작' }).click();

  // Q3: 킥오프 전 선발 변경은 교체가 아님
  await p.getByTestId('bench').locator('.chip').first().click();
  await p.getByTestId('slot:fw1').click();
  const tab = await p.locator('.tactics .tabs button').first().innerText();
  check(tab.includes('선발 정하기') && !tab.includes('4회'), 'Q3 킥오프 전 선수 변경은 교체 횟수를 쓰지 않음');

  await p.getByRole('button', { name: '🎉 킥오프!' }).click();
  const resume = p.getByRole('button', { name: '▶ 경기 재개' });
  for (let i = 0; i < 300 && !(await p.getByTestId('summary-1').isVisible()); i++) {
    if (await resume.isVisible()) await resume.click();
    await p.waitForTimeout(100);
  }
  // Q1: 후반 시작 버튼 연타
  await p.getByTestId('start-second-half').dblclick();
  await p.waitForTimeout(400);
  const clock = parseInt(await p.locator('.scoreboard__clock b').innerText(), 10);
  check(clock >= 45, `Q1 후반 시작 연타해도 후반 유지 (시계 ${clock}분)`);
  for (let i = 0; i < 300 && !(await p.getByTestId('final').isVisible()); i++) {
    if (await resume.isVisible()) await resume.click();
    await p.waitForTimeout(100);
  }
  check(await p.getByTestId('final').isVisible(), 'Q1 연타 후에도 90분 정상 종료');
  await p.context().close();
}

// ─────────────── R2-1: 고칠 수 없는 AI 오류는 한 번만, 잠깐 초과는 재시도 ───────────────
async function firstHalfAiCalls(status, message) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await p.addInitScript(() =>
    localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [], settings: { engine: 'gemini', geminiKey: 'k', playbackMs: 40 } }, version: 0 })),
  );
  let calls = 0;
  await p.route('**/generativelanguage.googleapis.com/**', (route) => {
    calls++;
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status, status: 'RESOURCE_EXHAUSTED', message } }) });
  });
  await p.goto(URL);
  await p.getByText('연습용 팀 2개 불러오기').click();
  await p.getByRole('button', { name: /경기$/ }).click();
  await p.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await p.getByRole('button', { name: '🎉 킥오프!' }).click();
  const resume = p.getByRole('button', { name: '▶ 경기 재개' });
  for (let i = 0; i < 600 && !(await p.getByTestId('summary-1').isVisible()); i++) {
    if (await resume.isVisible()) await resume.click();
    await p.waitForTimeout(100);
  }
  const done = await p.getByTestId('summary-1').isVisible();
  await p.context().close();
  return { calls, done };
}
{
  const permanent = await firstHalfAiCalls(429, 'Quota exceeded for metric: free_tier_requests, limit: 0, model: x');
  check(permanent.done && permanent.calls === 1, `R2-1 한도 0 오류: 전반 AI 요청 ${permanent.calls}회(1회여야 함), 경기 계속`);
  const transient = await firstHalfAiCalls(429, 'Resource has been exhausted. Please retry in 20s.');
  check(transient.done && transient.calls === 3, `R2-1 잠깐 사용량 초과: 구간마다 재시도 ${transient.calls}회(3회), 경기 계속`);
}

const painter = await b.newPage({ viewport: { width: 900, height: 1200 } });
await painter.setContent('<canvas id=c width=900 height=1200></canvas><script>const x=c.getContext("2d");for(let i=0;i<4000;i++){x.fillStyle=`hsl(${Math.random()*360},80%,50%)`;x.fillRect(Math.random()*900,Math.random()*1200,30,30)}</script>');
const img = await painter.screenshot({ type: 'jpeg', quality: 95 });
await painter.close();

// ① localStorage가 꽉 차도 사진 선수 저장 유지
{
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/');
  await p.getByText('연습용 팀 2개 불러오기').click();
  await p.evaluate(() => { let i = 0; for (const size of [1e6, 1e5, 1e4, 1e3, 100]) { try { for (;;) localStorage.setItem('junk' + i++, 'x'.repeat(size)); } catch {} } });
  for (let n = 1; n <= 3; n++) {
    await p.getByText('카드 1장 찍어서').click();
    await p.locator('input[type=file]').setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: img });
    await p.getByPlaceholder('선수 이름').fill('사진선수' + n);
    await p.getByRole('button', { name: '저장' }).click();
  }
  await p.waitForTimeout(500);
  await p.reload();
  await p.getByText('번개 FC').first().waitFor();
  const kept = await p.getByText(/사진선수\d/).count();
  check(kept === 3 && errs.length === 0, `Q2 localStorage가 꽉 차도 사진 선수 저장 유지 (${kept}/3)`);
}
// ② 예전 버전(localStorage) 데이터 자동 이전: 옛 데이터만 있는 상태에서 새 버전 첫 실행
{
  const ctx = await b.newContext();
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [{ id: 't1', name: '옛날팀', emoji: '🦁', color: '#fff', players: [], lineup: { formationId: '4-4-2', slots: {} } }], settings: { engine: 'local' } }, version: 0 }));
  });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4173/');
  await p.getByText('옛날팀').first().waitFor({ timeout: 5000 });
  await p.waitForTimeout(300);
  const legacyLeft = await p.evaluate(() => localStorage.getItem('card-football-v1'));
  await p.reload();
  await p.getByText('옛날팀').first().waitFor({ timeout: 5000 });
  check(legacyLeft === null, 'Q2 예전 localStorage 데이터 → IndexedDB 자동 이전 후 유지');
}
// ③ 저장 실패 강제 → 경고 표시
{
  const p = await (await b.newContext()).newPage();
  await p.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.__failSave) throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await p.goto('http://localhost:4173/');
  await p.getByText('연습용 팀 2개 불러오기').click();
  await p.evaluate(() => (window.__failSave = true));
  await p.getByText('카드 1장 찍어서').click();
  await p.getByPlaceholder('선수 이름').fill('실패선수');
  await p.getByRole('button', { name: '저장' }).click();
  await p.getByTestId('save-warning').waitFor({ timeout: 3000 }).catch(() => {});
  check((await p.getByTestId('save-warning').count()) === 1, 'Q2 저장 실패 시 경고 표시');
  await p.evaluate(() => (window.__failSave = false));
  await p.getByText('카드 1장 찍어서').click();
  await p.getByPlaceholder('선수 이름').fill('성공선수');
  await p.getByRole('button', { name: '저장' }).click();
  await p.waitForTimeout(300);
  check((await p.getByTestId('save-warning').count()) === 0, 'Q2 다시 저장되면 경고 사라짐');
}

await b.close();
let failed = false;
for (const [ok, label] of results) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
