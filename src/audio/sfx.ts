import crowdGoalUrl from '../assets/sounds/crowd-goal.mp3';
import crowdSaveUrl from '../assets/sounds/crowd-save.mp3';
import whistleFulltimeUrl from '../assets/sounds/whistle-fulltime.mp3';
import whistleHalftimeUrl from '../assets/sounds/whistle-halftime.mp3';
import whistleKickoffUrl from '../assets/sounds/whistle-kickoff.mp3';

// ─────────────────────────────────────────────
// 효과음
//
//  1순위: 음원 파일 (src/assets/sounds/*.mp3)
//    - 심판 휘슬(킥오프 1번·전반 종료 2번·경기 종료 3번), 골 함성, 슈퍼 세이브 탄성
//    - 실제 녹음 파일로 바꾸려면 같은 이름의 mp3로 덮어쓰기만 하면 된다
//  2순위: 파일을 못 불러오면 Web Audio로 즉석 합성한 소리 (경기가 조용해지지 않게)
//
// 브라우저는 "사용자가 누른 순간"에만 소리를 켤 수 있어서
// 킥오프 버튼을 누를 때 unlockSfx()로 오디오를 깨우고 음원도 미리 불러 둔다.
// ─────────────────────────────────────────────

export type SfxKind = 'kickoff' | 'halftime' | 'fulltime' | 'goal' | 'save';

const SOUND_FILES: Record<SfxKind, { url: string; volume: number }> = {
  kickoff: { url: whistleKickoffUrl, volume: 0.8 },
  halftime: { url: whistleHalftimeUrl, volume: 0.8 },
  fulltime: { url: whistleFulltimeUrl, volume: 0.8 },
  goal: { url: crowdGoalUrl, volume: 1 },
  save: { url: crowdSaveUrl, volume: 0.9 },
};

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

// ─────────────── 음원 파일 불러오기 ───────────────

const buffers = new Map<SfxKind, Promise<AudioBuffer | null>>();

/** 음원을 한 번만 내려받아 해독해 둔다 (실패하면 null → 합성음으로 대체) */
function loadBuffer(ac: AudioContext, kind: SfxKind): Promise<AudioBuffer | null> {
  let pending = buffers.get(kind);
  if (!pending) {
    pending = fetch(SOUND_FILES[kind].url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => ac.decodeAudioData(data))
      .catch(() => null);
    buffers.set(kind, pending);
  }
  return pending;
}

function playBuffer(ac: AudioContext, buffer: AudioBuffer, volume: number) {
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(ac.destination);
  source.start();
}

/** 사용자 터치 순간에 불러서 오디오를 깨우고, 음원을 미리 받아 둔다 (iOS·크롬 자동재생 정책 대응) */
export function unlockSfx(): void {
  const ac = getContext();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
  (Object.keys(SOUND_FILES) as SfxKind[]).forEach((kind) => void loadBuffer(ac, kind));
}

// ─────────────── 대체용 합성음 (음원을 못 불러올 때) ───────────────

/** 호루라기 한 번 (start초 뒤부터 length초 동안) */
function whistle(ac: AudioContext, start: number, length: number) {
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
function crowdRoar(ac: AudioContext, length = 3) {
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

/** 응원 나팔 "빠-빠-빠밤!" */
function hornFanfare(ac: AudioContext) {
  const notes: [freq: number, at: number, len: number][] = [
    [523, 0.1, 0.16],
    [523, 0.3, 0.16],
    [659, 0.5, 0.16],
    [784, 0.7, 0.6],
  ];
  for (const [freq, at, len] of notes) {
    const t0 = ac.currentTime + at;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const soft = ac.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 1800;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
    gain.gain.setValueAtTime(0.09, t0 + len - 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + len);
    osc.connect(soft).connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
  }
}

// ─────────────── 공개 함수 ───────────────

/** 상황별 효과음 재생 (오디오를 못 쓰는 환경에서는 조용히 무시) */
export function playSfx(kind: SfxKind): void {
  const ac = getContext();
  if (!ac) return;
  void loadBuffer(ac, kind).then((buffer) => {
    try {
      if (buffer) playBuffer(ac, buffer, SOUND_FILES[kind].volume);
      else playSynth(ac, kind);
    } catch {
      /* 오디오 오류로 경기가 멈추면 안 된다 */
    }
  });
}

function playSynth(ac: AudioContext, kind: SfxKind): void {
  try {
    switch (kind) {
      case 'kickoff':
        whistle(ac, 0, 0.7);
        break;
      case 'halftime':
        whistle(ac, 0, 0.35);
        whistle(ac, 0.5, 0.9);
        break;
      case 'fulltime':
        whistle(ac, 0, 0.3);
        whistle(ac, 0.45, 0.3);
        whistle(ac, 0.9, 1.1);
        break;
      case 'goal':
        crowdRoar(ac);
        hornFanfare(ac);
        break;
      case 'save':
        crowdRoar(ac, 1.8);
        break;
    }
  } catch {
    /* 오디오 오류로 경기가 멈추면 안 된다 */
  }
}
