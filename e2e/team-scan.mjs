// ─────────────────────────────────────────────
// QA: "팀 한 번에 등록" E2E
// 실제 AI 대신 제미나이 서버 응답을 흉내 내서(route mock) 전체 흐름을 검증한다.
// 실행: npm run build && npx vite preview --port 4173 & node e2e/team-scan.mjs
// ─────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pw = await import('playwright').catch(() => {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(`${globalRoot}/playwright/index.js`).href);
});
const { chromium } = pw.default ?? pw;

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });

// 사진 속 카드 4장 (한별은 이미 번개 FC에 있는 이름 → 중복 처리 확인)
const CARDS = [
  { name: '한별', number: 1, position: 'GK', role: 'GK', overall: 78 },
  { name: '하늘', number: 7, position: 'RW', role: 'FW', overall: 83 },
  { name: '별찌', number: 8, position: 'CM', role: 'MF', overall: 76 },
  { name: '누리', number: 4, position: 'CB', role: 'DF', overall: 72 },
];
const stats = { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 };
// 1000x750 사진에서 카드 위치 → 0~1000 비율 좌표
const boxOf = (i) => [200, 50 + i * 240, 867, 250 + i * 240];

const browser = await chromium.launch();
const errors = [];

// 1) 가짜 "카드 4장 단체 사진" 만들기
const painter = await browser.newPage({ viewport: { width: 1000, height: 750 } });
await painter.setContent(`
  <body style="margin:0;background:#7a5230;width:1000px;height:750px;position:relative;font-family:sans-serif">
    ${CARDS.map((c, i) => `
      <div style="position:absolute;left:${50 + i * 240}px;top:150px;width:200px;height:500px;border-radius:14px;
        background:linear-gradient(145deg,#f8e08e,#c9a23f);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
        <b style="font-size:60px">${c.overall}</b><span style="font-size:28px">${c.position}</span><span style="font-size:34px">${c.name}</span>
      </div>`).join('')}
  </body>`);
const photo = await painter.screenshot({ type: 'jpeg' });
await painter.close();

// 2) 앱 열기 (제미나이 엔진 + 가짜 키)
const { devices } = pw.default ?? pw;
const context = await browser.newContext(process.env.PHONE ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() =>
  localStorage.setItem(
    'card-football-v1',
    JSON.stringify({ state: { teams: [], settings: { engine: 'gemini', geminiKey: 'test-key' } }, version: 0 }),
  ),
);

let aiCalls = 0;
await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
  aiCalls += 1;
  const body = JSON.parse(route.request().postData() ?? '{}');
  const sentImage = JSON.stringify(body).includes('inlineData');
  if (!sentImage) errors.push('AI 요청에 사진이 포함되지 않음');
  const text = JSON.stringify({ cards: CARDS.map((c, i) => ({ ...c, stats, box: boxOf(i) })) });
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
  });
});

await page.goto(URL);
await page.getByText('연습용 팀 2개 불러오기').click();
await page.getByText('팀 등록').first().click();

// 3) 앨범에서 사진 선택 → AI 분석 → 목록 확인
await page.getByTestId('team-album').setInputFiles({ name: 'team.jpg', mimeType: 'image/jpeg', buffer: photo });
await page.getByTestId('bulk-list').waitFor({ timeout: 15000 });
const rows = await page.getByTestId('bulk-list').locator('li').count();
const thumbs = await page.getByTestId('bulk-list').locator('img').count();
const saveLabel = await page.getByTestId('bulk-save').innerText();
const dupShown = await page.getByText('이미 등록된 이름이에요').count();
await page.screenshot({ path: `${OUT}/team-scan-review.png` });
console.log(`찾은 카드 ${rows}장 / 잘라낸 사진 ${thumbs}장 / 버튼 "${saveLabel}" / 중복 표시 ${dupShown}건`);

// 4) 이름 하나 고치고 추가
await page.getByTestId('bulk-list').locator('li').nth(1).getByLabel('이름').fill('하늘별');
await page.getByTestId('bulk-save').click();
await page.getByText('하늘별').first().waitFor();
const badge = await page.locator('.team-head .badge').innerText();
await page.screenshot({ path: `${OUT}/team-scan-roster.png` });
console.log(`추가 후: ${badge}`);

await browser.close();

const checks = [
  [aiCalls === 1, `AI 호출 1회 (실제 ${aiCalls})`],
  [rows === 4, '카드 4장 인식'],
  [thumbs === 4, '카드별 사진 잘라내기 4장'],
  [dupShown === 1 && saveLabel.startsWith('3명'), '중복 이름은 기본 제외 → 3명 추가'],
  [badge.includes('전체 17명'), '14명 + 3명 = 17명'],
  [errors.length === 0, `페이지 오류 없음 ${errors.join(', ')}`],
];
let failed = false;
for (const [ok, label] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
