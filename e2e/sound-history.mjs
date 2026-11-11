// ─────────────────────────────────────────────
// QA: 중계 속도 5단계 · 효과음/음성 해설 · 리그 추가 · 최근 경기 기록(10경기)
// 실행: npm run build && npx vite preview --port 4173 & node e2e/sound-history.mjs
//
// 실제 소리는 자동 테스트로 들을 수 없으므로, 브라우저의 AudioContext·speechSynthesis를
// 가짜로 바꿔 "언제 무엇을 재생/낭독했는지"를 기록해서 검사한다.
// ─────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const pw = await import('playwright').catch(() => {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(`${globalRoot}/playwright/index.js`).href);
});
const { chromium } = pw.default ?? pw;
const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const results = [];
const check = (ok, label) => results.push([Boolean(ok), label]);
const errors = [];

/**
 * 가짜 오디오: 어떤 음원 파일을 재생했는지(files), 대체 합성 휘슬(사인파 2750Hz) 횟수(synthWhistles),
 * 낭독 문장(speech)을 window.__audio에 기록
 */
function fakeAudio() {
  const log = { files: [], synthWhistles: 0, speech: [] };
  window.__audio = log;
  // 내려받은 음원 데이터 → 파일 이름 (decodeAudioData에서 어떤 소리인지 알아내려고)
  const names = new WeakMap();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const m = String(input).match(/(whistle-[a-z]+|crowd-[a-z]+)/);
    if (!m || !res.ok) return res;
    const data = await res.arrayBuffer();
    names.set(data, m[1]);
    return { ok: true, status: 200, arrayBuffer: async () => data };
  };
  const node = () => ({ connect: (n) => n ?? node(), gain: param(), frequency: param(), Q: param(), start() {}, stop() {}, type: '' });
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeCtx {
    state = 'running';
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    resume() { return Promise.resolve(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() {
      const o = node();
      const f = o.frequency;
      o.start = () => { if (f.value === 2750) log.synthWhistles += 1; };
      return o;
    }
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
    decodeAudioData(data) { return Promise.resolve({ name: names.get(data) ?? 'unknown' }); }
    createBufferSource() {
      const s = node();
      s.start = () => { if (s.buffer?.name) log.files.push(s.buffer.name); };
      return s;
    }
  }
  window.AudioContext = FakeCtx;
  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => [],
    cancel() {},
    speak(u) { if (u.text.trim()) log.speech.push(u.text); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
}

async function newPage(settings = {}, contextOptions = {}, { expectBlockedRequests = false } = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 }, ...contextOptions })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (expectBlockedRequests && m.text().includes('net::ERR_FAILED')) return; // 일부러 막은 요청
    errors.push(m.text());
  });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(fakeAudio);
  await page.addInitScript((s) => {
    if (!localStorage.getItem('card-football-v1')) {
      localStorage.setItem('card-football-v1', JSON.stringify({ state: { teams: [], settings: { playbackMs: 40, ...s } }, version: 0 }));
    }
  }, settings);
  await page.goto(URL);
  return page;
}

/** 경기 하나를 끝까지 진행 */
async function playFullMatch(page) {
  await page.getByRole('button', { name: /경기$/ }).click();
  await page.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await page.getByTestId('kickoff').click();
  const resume = page.getByRole('button', { name: '▶ 경기 재개' });
  const second = page.getByTestId('start-second-half');
  for (let i = 0; i < 600 && !(await page.getByTestId('final').isVisible()); i++) {
    if (await resume.isVisible()) await resume.click();
    if (await second.isVisible()) await second.click();
    await page.waitForTimeout(50);
  }
}

// ─────────────── 1) 설정 화면: 속도 5단계 + 소리 토글 ───────────────
{
  const page = await newPage();
  await page.getByRole('button', { name: /AI 설정/ }).click();
  const speeds = await page.locator('.seg button').allInnerTexts();
  check(speeds.join('|') === '아주 천천히|천천히|조금 천천히|보통|빠르게', `속도 5단계 표시 (${speeds.join(', ')})`);
  await page.getByRole('button', { name: '아주 천천히' }).click();
  check(await page.getByRole('button', { name: '아주 천천히' }).evaluate((b) => b.classList.contains('on')), '아주 천천히 선택 유지');

  check((await page.getByTestId('toggle-sfx').getAttribute('aria-checked')) === 'true', '효과음 기본 켜짐');
  check((await page.getByTestId('toggle-voice').getAttribute('aria-checked')) === 'true', '음성 해설 기본 켜짐');
  await page.getByTestId('toggle-voice').click();
  check((await page.getByTestId('toggle-voice').getAttribute('aria-checked')) === 'false', '음성 해설 끄기');
  await page.close();
}

// ─────────────── 2) 리그 추가: 랜덤 뽑기 화면에 새 리그 노출 ───────────────
{
  const page = await newPage();
  await page.getByText('연습용 팀 2개 불러오기').click();
  const draftBtn = page.getByRole('button', { name: /랜덤/ }).first();
  if (await draftBtn.isVisible()) {
    await draftBtn.click();
    const text = await page.locator('body').innerText();
    for (const name of ['세리에 A', '브라질 세리이 A', '사우디 프로리그']) check(text.includes(name), `랜덤 뽑기에 '${name}' 리그 표시`);
  } else {
    check(false, '랜덤 뽑기 버튼을 찾지 못함');
  }
  await page.close();
}

// ─────────────── 3) 경기: 휘슬·함성·해설 + 기록 저장 ───────────────
{
  const page = await newPage();
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByRole('button', { name: /경기$/ }).click();
  check(await page.getByText('아직 끝까지 마친 경기가 없어요').isVisible(), '기록이 없을 때 안내 문구');
  await page.getByRole('button', { name: /팀 관리/ }).click();

  await playFullMatch(page);
  const audio = await page.evaluate(() => window.__audio);
  const score = (await page.getByTestId('score').innerText()).replace(/\s/g, '');
  const goals = score.split(':').map(Number).reduce((a, b) => a + b, 0);

  const superSaves = await page.locator('[data-testid="feed"] .feed__item--save.feed__item--hl').count();
  const played = (name) => audio.files.filter((f) => f === name).length;

  // 휘슬 음원: 킥오프·후반 시작 = 1번 휘슬 파일, 전반 종료 = 2번 휘슬 파일, 경기 종료 = 3번 휘슬 파일
  check(played('whistle-kickoff') === 2, `킥오프·후반 시작 휘슬 음원 2번 → ${played('whistle-kickoff')}번`);
  check(played('whistle-halftime') === 1, `전반 종료 휘슬 음원 1번 → ${played('whistle-halftime')}번`);
  check(played('whistle-fulltime') === 1, `경기 종료 휘슬 음원 1번 → ${played('whistle-fulltime')}번`);
  check(audio.synthWhistles === 0, '음원을 불러왔으면 합성 휘슬은 쓰지 않음');
  check(played('crowd-goal') === goals, `골 함성 음원 = 골 수 (${goals}골 → ${played('crowd-goal')}번)`);
  check(played('crowd-save') === superSaves, `슈퍼 세이브 함성 = 슈퍼 세이브 수 (${superSaves}번 → ${played('crowd-save')}번)`);
  check(audio.speech.filter((t) => t.startsWith('슈퍼 세이브!')).length === superSaves, '슈퍼 세이브 해설');
  check(audio.speech.some((t) => t.startsWith('킥오프')), '킥오프 해설');
  check(audio.speech.some((t) => t.includes('경기 종료') && /\d 대 \d/.test(t)), '경기 종료 해설 + 최종 점수');
  check(goals === 0 || audio.speech.filter((t) => t.includes('골')).length >= goals, '골마다 골 해설');
  check(audio.speech.every((t) => !/\p{Extended_Pictographic}/u.test(t)), '해설 문장에 이모지 없음');

  await page.getByRole('button', { name: '🔄 새 경기' }).click();
  check((await page.getByTestId('history-item').count()) === 1, '경기 종료 후 기록 1건 저장');
  const item = await page.getByTestId('history-item').first().innerText();
  check(item.includes(score.replace(':', ' : ')), `기록 점수 = 최종 점수 (${score})`);

  // 소리 끄기 버튼: 경기 중 바로 음소거
  await page.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await page.getByTestId('sound-toggle').click();
  check((await page.getByTestId('sound-toggle').innerText()).includes('소리 끔'), '경기 화면 빠른 음소거');
  const before = await page.evaluate(() => window.__audio.files.length + window.__audio.speech.length);
  await page.getByTestId('kickoff').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__audio.files.length + window.__audio.speech.length);
  check(after === before, '음소거 상태에서는 휘슬·해설 없음');
  await page.close();
}

// ─────────────── 3-2) 음원 파일을 못 받으면 합성 휘슬로 대체 ───────────────
{
  // 서비스 워커가 요청을 대신 처리하면 차단 규칙을 우회하므로 이 검사에서는 끈다
  const page = await newPage({ voice: false }, { serviceWorkers: 'block' }, { expectBlockedRequests: true });
  await page.route('**/*.mp3', (route) => route.abort());
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByRole('button', { name: /경기$/ }).click();
  await page.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await page.getByTestId('kickoff').click();
  await page.waitForTimeout(800);
  const audio = await page.evaluate(() => window.__audio);
  check(audio.files.length === 0 && audio.synthWhistles >= 1, `음원 차단 시 합성 휘슬로 대체 (합성 ${audio.synthWhistles}번)`);
  await page.close();
}

// ─────────────── 4) 기록은 최근 10경기만 (새로고침 후에도 유지) ───────────────
{
  const page = await newPage({ voice: false, sfx: false });
  await page.getByText('연습용 팀 2개 불러오기').click();
  for (let i = 0; i < 11; i++) {
    await playFullMatch(page);
    await page.getByRole('button', { name: '🔄 새 경기' }).click();
    await page.getByRole('button', { name: /팀 관리/ }).click();
  }
  await page.getByRole('button', { name: /경기$/ }).click();
  check((await page.getByTestId('history-item').count()) === 10, '11경기 후에도 기록은 10건');
  await page.reload();
  await page.getByRole('button', { name: /경기$/ }).click();
  check((await page.getByTestId('history-item').count()) === 10, '새로고침 후에도 기록 10건 유지');
  await page.getByRole('button', { name: '기록 지우기' }).click();
  check(await page.getByText('아직 끝까지 마친 경기가 없어요').isVisible(), '기록 지우기');
  await page.close();
}

// ─────────────── 5) 음성 해설 낭독 중에는 다음 장면을 기다린다 ───────────────
{
  const page = await newPage();
  await page.addInitScript(() => {
    // 낭독이 1.5초 걸리는 가짜 목소리
    const synth = window.speechSynthesis;
    synth.speak = (u) => {
      if (!u.text.trim()) return;
      window.__audio.speech.push(u.text);
      synth.speaking = true;
      setTimeout(() => { synth.speaking = false; u.onend?.(); }, 1500);
    };
  });
  await page.reload();
  await page.getByText('연습용 팀 2개 불러오기').click();
  await page.getByRole('button', { name: /경기$/ }).click();
  await page.getByRole('button', { name: '⚽ 경기 시작' }).click();
  await page.getByTestId('kickoff').click();
  await page.waitForTimeout(1000);
  const feed = await page.getByTestId('feed').locator('li').count();
  // 재생 간격 40ms라도, 킥오프 해설(1.5초)이 끝나기 전에는 다음 장면이 나오지 않아야 한다
  check(feed <= 2, `해설 중에는 장면 대기 (1초 동안 공개된 장면 ${feed}개)`);
  await page.close();
}

await browser.close();

for (const [ok, label] of results) console.log(`${ok ? '✅' : '❌'} ${label}`);
if (errors.length) console.log('페이지 오류:\n' + errors.join('\n'));
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 통과`);
process.exit(failed || errors.length ? 1 : 0);
