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
 * 가짜 오디오: 어떤 효과음 파일을 몇 번 틀었는지와 낭독 문장을 window.__audio에 기록
 *  - sfx/*.mp3 요청은 "파일 이름"만 담은 가짜 응답으로 바꾸고, 디코딩 결과에 그 이름을 붙여 둔다
 */
function fakeAudio() {
  const log = { clips: {}, synth: 0, speech: [], voice: 0 };
  window.__audio = log;
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const m = String(url).match(/sfx\/([\w-]+)\.mp3/);
    return m ? Promise.resolve(new Response(m[1])) : realFetch(url, init);
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
      o.start = () => { log.synth += 1; };
      return o;
    }
    createBuffer(_c, len, rate) {
      const data = new Float32Array(len);
      return { length: len, duration: len / (rate || 8000), getChannelData: () => data };
    }
    decodeAudioData(data) { return Promise.resolve({ clip: new TextDecoder().decode(data) }); }
    createBufferSource() {
      const s = node();
      s.start = () => {
        const name = s.buffer?.clip;
        if (name) log.clips[name] = (log.clips[name] ?? 0) + 1;
        else if (s.buffer?.length > 1) log.voice += 1; // AI 해설 목소리 (무음 1샘플은 제외)
        setTimeout(() => s.onended?.(), 50);
      };
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

async function newPage(settings = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // 사용량 초과(429)는 테스트에서 일부러 낸 오류라 제외
  page.on('console', (m) => m.type() === 'error' && !/status of 429/.test(m.text()) && errors.push(m.text()));
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
  await page.getByTestId('sfx-test').click();
  await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__audio.clips['whistle-end'])) === 1, '효과음 들어보기 → 종료 휘슬 재생');
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
  /** 'shot-'처럼 이름이 같은 묶음(shot-1, shot-2…)의 재생 횟수 합 */
  audio.count = (prefix) => Object.entries(audio.clips).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);
  const score = (await page.getByTestId('score').innerText()).replace(/\s/g, '');
  const goals = score.split(':').map(Number).reduce((a, b) => a + b, 0);

  // 시작 휘슬: 킥오프 + 후반 시작 / 종료 휘슬: 전반 종료 + 경기 종료
  check(audio.clips['whistle-start'] === 2, `시작 휘슬 2번 (킥오프·후반 시작) → ${audio.clips['whistle-start']}번`);
  check(audio.clips['whistle-end'] === 2, `종료 휘슬 2번 (전반·경기 종료) → ${audio.clips['whistle-end']}번`);
  check(audio.clips['crowd-goal'] === goals || (goals === 0 && !audio.clips['crowd-goal']), `골 함성 = 골 수 (${goals}골 → ${audio.clips['crowd-goal'] ?? 0}번)`);
  check(audio.count('shot-') >= goals, `골·슈팅마다 슈팅음 (${audio.count('shot-')}번)`);
  check(audio.count('dribble-') + audio.count('kick-') + (audio.clips['whistle-foul'] ?? 0) > 0, `경기 중 드리블·킥·파울 소리 (${JSON.stringify(audio.clips)})`);
  check(audio.synth === 0, '음원 파일을 불러왔으므로 합성음은 쓰지 않음');
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
  const before = await page.evaluate(() => Object.values(window.__audio.clips).reduce((a, b) => a + b, 0) + window.__audio.speech.length);
  await page.getByTestId('kickoff').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => Object.values(window.__audio.clips).reduce((a, b) => a + b, 0) + window.__audio.speech.length);
  check(after === before, '음소거 상태에서는 효과음·해설 없음');
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

// ─────────────── 6) AI 남자 목소리 (제미나이 음성 합성) ───────────────
{
  // 0.1초짜리 무음 PCM(24kHz, 16비트)을 담은 가짜 제미나이 음성 응답
  const pcm = Buffer.alloc(4800).toString('base64');
  const ttsBody = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm } }] } }] });

  const page = await newPage({ geminiKey: 'test-key' });
  const voices = [];
  await page.route('**/generativelanguage.googleapis.com/**', (route) => {
    voices.push(route.request().postDataJSON()?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName);
    route.fulfill({ status: 200, contentType: 'application/json', body: ttsBody });
  });
  await page.getByRole('button', { name: /AI 설정/ }).click();
  check((await page.getByTestId('toggle-ai-voice').getAttribute('aria-checked')) === 'true', 'AI 남자 목소리 기본 켜짐');
  await page.getByTestId('voice-test').click();
  await page.waitForTimeout(1500);
  check(voices[0] === 'Fenrir', `제미나이에 남자 목소리(Fenrir) 요청 (${voices[0]})`);
  check((await page.evaluate(() => window.__audio.voice)) >= 1, 'AI 목소리 음성 재생');
  check((await page.evaluate(() => window.__audio.speech.length)) === 0, 'AI 목소리가 되면 기기 목소리는 안 씀');

  // AI 목소리 끄기 → 기기 목소리
  await page.getByTestId('toggle-ai-voice').click();
  const before = voices.length;
  await page.getByTestId('voice-test').click();
  await page.waitForTimeout(500);
  check(voices.length === before && (await page.evaluate(() => window.__audio.speech.length)) === 1, 'AI 목소리 끄면 기기 목소리로 읽음');
  await page.close();
}
{
  // 사용량 초과 → 기기 목소리로 대신 읽는다
  const page = await newPage({ geminiKey: 'test-key' });
  await page.route('**/generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) }),
  );
  await page.getByRole('button', { name: /AI 설정/ }).click();
  await page.getByTestId('voice-test').click();
  await page.waitForTimeout(1500);
  check((await page.evaluate(() => window.__audio.speech.length)) === 1, 'AI 목소리 실패 시 기기 목소리로 대신 읽음');
  await page.close();
}

await browser.close();

for (const [ok, label] of results) console.log(`${ok ? '✅' : '❌'} ${label}`);
if (errors.length) console.log('페이지 오류:\n' + errors.join('\n'));
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 통과`);
process.exit(failed || errors.length ? 1 : 0);
