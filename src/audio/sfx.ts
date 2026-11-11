// ─────────────────────────────────────────────
// 효과음 — 실제 녹음 음원(public/sfx/*.mp3)을 Web Audio API로 재생한다
//
//  - 휘슬: 시작 / 종료 / 파울 세 가지 실제 호루라기 소리
//  - 경기 소리: 공 차는 소리 · 슈팅 · 드리블 · 관중 함성 (여러 개 중 무작위로 골라 단조롭지 않게)
//  - 음원을 못 불러오는 환경(오프라인 첫 실행 등)에서는 예전처럼 휘슬·함성을 직접 합성한다
//
// 브라우저는 "사용자가 누른 순간"에만 소리를 켤 수 있어서
// 킥오프 버튼을 누를 때 unlockSfx()를 불러 오디오를 깨워 둔다.
// ─────────────────────────────────────────────

/** 경기 상황별 효과음 종류 */
export type SfxKind =
  | 'kickoff' // 킥오프·후반 시작
  | 'halftime' // 전반 종료
  | 'fulltime' // 경기 종료
  | 'goal' // 골
  | 'foul' // 파울·경고·퇴장·오프사이드
  | 'shot' // 슈팅
  | 'save' // 골키퍼 선방
  | 'dribble' // 돌파·빌드업
  | 'kick'; // 코너킥 등 일반 킥

// ─────────────── 음원 목록 ───────────────

/** 소리 묶음 → 실제 파일들 (여러 개면 재생할 때마다 하나를 무작위로 고른다) */
const CLIPS = {
  'whistle-start': ['whistle-start'],
  'whistle-end': ['whistle-end'],
  'whistle-foul': ['whistle-foul'],
  kick: ['kick-1', 'kick-2', 'kick-3', 'kick-4'],
  shot: ['shot-1', 'shot-2', 'shot-3'],
  dribble: ['dribble-1', 'dribble-2', 'dribble-3', 'dribble-4'],
  'crowd-short': ['crowd-short'],
  'crowd-goal': ['crowd-goal'],
} as const;

type ClipGroup = keyof typeof CLIPS;

/** 한 장면에서 낼 소리 한 조각 */
interface Step {
  clip: ClipGroup;
  /** 장면 시작 후 몇 초 뒤에 낼지 */
  at?: number;
  /** 0~1 음량 */
  volume?: number;
}

/** 상황별 소리 조합 */
const RECIPES: Record<SfxKind, Step[]> = {
  kickoff: [{ clip: 'whistle-start' }],
  halftime: [{ clip: 'whistle-end' }],
  fulltime: [{ clip: 'whistle-end' }, { clip: 'crowd-short', at: 1.1, volume: 0.7 }],
  goal: [{ clip: 'shot' }, { clip: 'crowd-goal', at: 0.15, volume: 0.9 }],
  foul: [{ clip: 'whistle-foul', volume: 0.8 }],
  shot: [{ clip: 'shot', volume: 0.9 }],
  save: [{ clip: 'crowd-short', volume: 0.75 }],
  dribble: [{ clip: 'dribble', volume: 0.7 }],
  kick: [{ clip: 'kick', volume: 0.9 }],
};

/** 전체 음량 (해설 목소리가 묻히지 않게 살짝 낮춘다) */
const MASTER_VOLUME = 0.8;

// ─────────────── 오디오 준비 ───────────────

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: AudioCtor | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 파일 이름 → 디코딩된 소리 */
const buffers = new Map<string, AudioBuffer>();
let loading: Promise<boolean> | null = null;

const clipUrl = (file: string) => `${import.meta.env.BASE_URL}sfx/${file}.mp3`;

async function loadClip(ac: AudioContext, file: string): Promise<void> {
  const res = await fetch(clipUrl(file));
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  const data = await res.arrayBuffer();
  // 옛 사파리는 decodeAudioData가 Promise를 돌려주지 않아서 콜백 방식으로 감싼다
  const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
    const maybe = ac.decodeAudioData(data, resolve, reject);
    if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
  });
  buffers.set(file, decoded);
}

/**
 * 모든 음원을 미리 불러 둔다 (경기 화면에 들어올 때 호출).
 * 결과: 하나라도 불러왔으면 true, 전부 실패하면 false (→ 합성음으로 대체)
 */
export function preloadSfx(): Promise<boolean> {
  if (loading) return loading;
  const ac = getContext();
  if (!ac || typeof fetch === 'undefined') return Promise.resolve(false);
  const files = Object.values(CLIPS).flat();
  loading = Promise.allSettled(files.map((f) => loadClip(ac, f))).then(() => buffers.size > 0);
  return loading;
}

// ─────────────── 오디오 깨우기 (특히 아이폰) ───────────────
//
//  아이폰 사파리에서 효과음이 안 나는 대표적인 이유 세 가지를 막는다.
//   1) 무음 스위치: 기본 설정이면 Web Audio가 무음 스위치를 따라 꺼진다
//      → audioSession을 'playback'(음악·영상과 같은 종류)으로 바꾼다 (지원하는 사파리에서만)
//   2) 잠금 해제: 터치하는 그 순간에 실제로 소리를 한 번 내야 풀린다
//      → 들리지 않는 아주 짧은 소리를 재생한다
//   3) 중단 상태: 음성 해설·전화·앱 전환 뒤 'interrupted'로 멈춘다
//      → 화면을 다시 터치하거나 돌아올 때마다, 그리고 재생 직전마다 다시 깨운다

/** 멈춰 있으면 다시 깨운다. 깨우기가 끝나거나 잠깐 기다려도 안 되면 진행 */
function wakeUp(ac: AudioContext): Promise<void> {
  if (ac.state === 'running') return Promise.resolve();
  const resumed = ac.resume().catch(() => undefined);
  const giveUp = new Promise<void>((done) => setTimeout(done, 300));
  return Promise.race([resumed, giveUp]);
}

/** 들리지 않는 1샘플짜리 소리 (iOS 잠금 해제용) */
function playSilence(ac: AudioContext) {
  const source = ac.createBufferSource();
  source.buffer = ac.createBuffer(1, 1, ac.sampleRate);
  source.connect(ac.destination);
  source.start(0);
}

let keepAliveInstalled = false;

/** 경기 중 화면을 터치하거나 앱으로 돌아올 때마다 오디오를 다시 깨운다 */
function installKeepAlive(ac: AudioContext) {
  if (keepAliveInstalled || typeof document === 'undefined') return;
  keepAliveInstalled = true;
  const revive = () => void wakeUp(ac);
  for (const type of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(type, revive, { passive: true });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && revive());
}

/** 사용자 터치 순간에 불러서 오디오를 깨운다 (iOS·크롬 자동재생 정책 대응) */
export function unlockSfx(): void {
  const audioSession =
    typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (audioSession) {
    try {
      audioSession.type = 'playback';
    } catch {
      /* 지원하지 않는 브라우저 */
    }
  }
  const ac = getContext();
  if (!ac) return;
  try {
    void wakeUp(ac);
    playSilence(ac);
  } catch {
    /* 오디오 오류로 경기가 멈추면 안 된다 */
  }
  installKeepAlive(ac);
  void preloadSfx();
}

// ─────────────── 음원 재생 ───────────────

const pickRandom = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** 묶음에서 하나 골라 재생. 불러온 파일이 없으면 false */
function playClip(ac: AudioContext, step: Step): boolean {
  const loaded = CLIPS[step.clip].filter((f) => buffers.has(f));
  if (loaded.length === 0) return false;

  const source = ac.createBufferSource();
  source.buffer = buffers.get(pickRandom(loaded))!;
  const gain = ac.createGain();
  gain.gain.value = (step.volume ?? 1) * MASTER_VOLUME;
  source.connect(gain).connect(ac.destination);
  source.start(ac.currentTime + (step.at ?? 0));
  return true;
}

// ─────────────── 대체용 합성음 (음원이 없을 때만) ───────────────

/** 호루라기 한 번 (start초 뒤부터 length초 동안) */
function synthWhistle(ac: AudioContext, start: number, length: number) {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 2750;

  // 호루라기 속 구슬이 굴러 생기는 떨림
  const lfo = ac.createOscillator();
  lfo.frequency.value = 32;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 180;
  lfo.connect(lfoDepth).connect(osc.frequency);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.22, t0 + 0.03);
  gain.gain.setValueAtTime(0.22, t0 + length - 0.06);
  gain.gain.linearRampToValueAtTime(0, t0 + length);

  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + length + 0.02);
  lfo.stop(t0 + length + 0.02);
}

/** 관중 함성 (대역 통과 잡음이 부풀었다 잦아든다) */
function synthRoar(ac: AudioContext, length = 3) {
  const t0 = ac.currentTime;
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * length), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = ac.createBufferSource();
  noise.buffer = buffer;

  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(600, t0);
  band.frequency.linearRampToValueAtTime(1100, t0 + 0.8);
  band.Q.value = 0.7;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.35, t0 + 0.5);
  gain.gain.setValueAtTime(0.35, t0 + length * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);

  noise.connect(band).connect(gain).connect(ac.destination);
  noise.start(t0);
  noise.stop(t0 + length);
}

/** 음원 없이 낼 수 있는 최소한의 소리 (휘슬·골 함성만) */
function playSynth(ac: AudioContext, kind: SfxKind) {
  switch (kind) {
    case 'kickoff':
      synthWhistle(ac, 0, 0.7);
      break;
    case 'foul':
      synthWhistle(ac, 0, 0.25);
      break;
    case 'halftime':
      synthWhistle(ac, 0, 0.35);
      synthWhistle(ac, 0.5, 0.9);
      break;
    case 'fulltime':
      synthWhistle(ac, 0, 0.3);
      synthWhistle(ac, 0.45, 0.3);
      synthWhistle(ac, 0.9, 1.1);
      break;
    case 'goal':
      synthRoar(ac);
      break;
    default:
      break; // 킥·드리블 등은 합성하지 않는다
  }
}

// ─────────────── 공개 함수 ───────────────

function play(ac: AudioContext, kind: SfxKind, filesReady: boolean) {
  try {
    const steps = RECIPES[kind];
    const played = filesReady && steps.map((step) => playClip(ac, step)).some(Boolean);
    if (!played) playSynth(ac, kind);
  } catch {
    /* 오디오 오류로 경기가 멈추면 안 된다 */
  }
}

/** 상황별 효과음 재생 (오디오를 못 쓰는 환경에서는 조용히 무시) */
export function playSfx(kind: SfxKind): void {
  const ac = getContext();
  if (!ac) return;
  // 음원이 아직 로딩 중이면 끝난 뒤에 재생한다 (보통 킥오프 첫 휘슬만 아주 잠깐 늦는다)
  void preloadSfx().then(async (ready) => {
    await wakeUp(ac); // 음성 해설 등으로 멈춰 있었다면 다시 깨운 뒤 재생
    play(ac, kind, ready);
  });
}
