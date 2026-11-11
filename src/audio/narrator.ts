// ─────────────────────────────────────────────
// 음성 해설
//
//  1) 제미나이 키가 있고 "AI 남자 목소리"가 켜져 있으면 → 제미나이 음성 합성(남자 목소리)
//     아이폰·아이패드처럼 한국어 남자 목소리가 없는 기기에서도 진짜 남자 목소리가 난다.
//  2) 키가 없거나 AI 목소리가 실패하면 → 브라우저 내장 음성 합성(Web Speech API)
//     한국어 남자 목소리를 우선 찾고, 없으면 다른 한국어 목소리를 낮은 톤으로 읽는다.
//
//  공통 규칙
//  - 밀린 문장이 쌓이지 않게 "대기 문장은 최대 1개"만 남긴다
//  - 골처럼 급한 장면(urgent)은 말하던 것을 끊고 바로 읽는다
// ─────────────────────────────────────────────

import { isFatalVoiceError, isQuotaError, synthesizeMale } from './cloudVoice';
import { getContext, wakeUp } from './sfx';

// ─────────────── 설정 ───────────────

let cloudKey: string | null = null;
/** 이 시각까지는 AI 목소리를 쉬고 기기 목소리로 읽는다 (사용량 초과 등) */
let cloudPausedUntil = 0;

/** AI 남자 목소리에 쓸 제미나이 키 (null이면 기기 목소리만 쓴다) */
export function configureNarrator(geminiKey: string | null): void {
  const next = geminiKey?.trim() || null;
  if (next !== cloudKey) cloudPausedUntil = 0; // 키가 바뀌면 다시 시도
  cloudKey = next;
}

const cloudReady = () => !!cloudKey && Date.now() >= cloudPausedUntil && !!getContext();

function onCloudError(err: unknown) {
  if (isFatalVoiceError(err)) cloudPausedUntil = Number.POSITIVE_INFINITY;
  else if (isQuotaError(err)) cloudPausedUntil = Date.now() + 60_000; // 1분 쉬었다가 다시
}

// ─────────────── 기기 목소리 (Web Speech API) ───────────────

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

/**
 * 기기별로 알려진 한국어 남자 목소리 이름 일부.
 * Web Speech API는 성별 정보를 주지 않아서 이름으로 짐작한다.
 */
const MALE_HINTS = ['male', 'injoon', 'hyunsu', 'bongjin', 'gookmin', 'minsu', 'jinho', 'junho', '남성', '남자'];
const FEMALE_HINTS = ['female', '여성', '여자'];

const isMaleVoice = (v: SpeechSynthesisVoice) => {
  const name = v.name.toLowerCase();
  return MALE_HINTS.some((h) => name.includes(h)) && !FEMALE_HINTS.some((h) => name.includes(h));
};

/** 해설에 쓸 기기 목소리와, 그 목소리가 남자 목소리인지 */
function pickVoice(s: SpeechSynthesis): { voice?: SpeechSynthesisVoice; male: boolean } {
  const korean = s.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ko'));
  const male = korean.find(isMaleVoice);
  if (male) return { voice: male, male: true };
  return { voice: korean.find((v) => v.lang === 'ko-KR') ?? korean[0], male: false };
}

/**
 * 기기 목소리 마지막 문장이 늦어도 이때까지는 끝났다고 보는 시각.
 * 목소리가 없는 기기에서는 speaking 값이 계속 true로 남거나 onend가 오지 않을 수 있어서
 * 문장 길이로 낭독 시간을 넉넉히 어림잡아 그 이상은 기다리지 않는다.
 */
let speakingUntil = 0;

/** 한국어 낭독 시간 어림값: 글자당 약 0.13초 + 여유 1초 */
export const estimateSpeechMs = (text: string) => 1000 + text.length * 130;

function speakOnDevice(text: string, urgent: boolean): void {
  const s = synth();
  if (!s) return;
  // 급한 장면이거나 이미 한 문장이 대기 중이면 밀린 해설을 버린다
  if (urgent || s.pending) {
    speakingUntil = 0;
    s.cancel();
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const { voice, male } = pickVoice(s);
  if (voice) u.voice = voice;
  // 남자 목소리가 없는 기기는 톤을 크게 낮춰 남자 해설자 느낌을 낸다
  const basePitch = male ? 0.95 : 0.6;
  // 골 장면은 조금 더 빠르고 높게 → 흥분한 해설 느낌
  u.rate = urgent ? 1.15 : 1.05;
  u.pitch = urgent ? basePitch + 0.15 : basePitch;
  speakingUntil = Math.max(speakingUntil, Date.now()) + estimateSpeechMs(text);
  u.onend = u.onerror = () => {
    if (!s.speaking && !s.pending) speakingUntil = 0;
  };
  s.speak(u);
}

const deviceBusy = () => {
  const s = synth();
  return !!s && (s.speaking || s.pending) && Date.now() < speakingUntil;
};

// ─────────────── AI 목소리 재생 순서 관리 ───────────────

interface Line {
  text: string;
  urgent: boolean;
  /** 미리 만들기 시작한 음성 (앞 문장을 읽는 동안 받아 둔다) */
  audio: Promise<AudioBuffer>;
}

/** 늘어날 때마다 이전 재생 작업은 무효 (멈춤·끼어들기) */
let generation = 0;
let current: { line: Line; source?: AudioBufferSourceNode } | null = null;
let queued: Line | null = null;
/** 음성 받기가 멈춰 버려도 경기가 영원히 기다리지 않게 하는 마감 시각 */
let cloudDeadline = 0;

/** AI 음성 받기 최대 대기(8초) + 재생 시간 여유 */
const cloudBudgetMs = (text: string) => 8000 + estimateSpeechMs(text) * 1.5;

function startLine(ac: AudioContext, key: string, line: Line): void {
  const my = generation;
  current = { line };
  cloudDeadline = Date.now() + cloudBudgetMs(line.text);
  void line.audio.then(
    async (buffer) => {
      if (my !== generation) return;
      await wakeUp(ac);
      if (my !== generation) return;
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(ac.destination);
      source.onended = () => my === generation && next(ac, key);
      current = { line, source };
      cloudDeadline = Date.now() + buffer.duration * 1000 + 1500;
      source.start();
    },
    (err) => {
      if (my !== generation) return;
      onCloudError(err);
      current = null;
      speakOnDevice(line.text, line.urgent); // 이 문장은 기기 목소리로
      next(ac, key);
    },
  );
}

/** 대기 문장이 있으면 이어서 읽는다 */
function next(ac: AudioContext, key: string): void {
  current = null;
  const line = queued;
  queued = null;
  if (!line) return;
  if (cloudReady()) startLine(ac, key, line);
  else speakOnDevice(line.text, line.urgent);
}

function narrateWithCloud(ac: AudioContext, key: string, text: string, urgent: boolean): void {
  if (urgent) stopNarration();
  const line: Line = { text, urgent, audio: synthesizeMale(ac, key, text, urgent) };
  line.audio.catch(() => undefined); // 처리 안 된 오류 경고 막기 (실패는 startLine에서 처리)
  if (current) queued = line; // 대기 문장은 1개만 (예전 대기 문장은 버린다)
  else startLine(ac, key, line);
}

// ─────────────── 밖에서 쓰는 함수 ───────────────

/** 지금 읽고 있는 문장이 있는지 */
export function isNarrating(): boolean {
  const cloudBusy = (!!current || !!queued) && Date.now() < cloudDeadline;
  return cloudBusy || deviceBusy();
}

/** 읽던 문장과 대기 문장을 모두 멈춘다 */
export function stopNarration(): void {
  generation++;
  try {
    current?.source?.stop();
  } catch {
    /* 이미 끝난 소리 */
  }
  current = null;
  queued = null;
  cloudDeadline = 0;
  speakingUntil = 0;
  synth()?.cancel();
}

/** 사용자 터치 순간에 불러서 음성 합성을 깨운다 (iOS 사파리는 첫 발화가 터치 안에서 일어나야 함) */
export function unlockNarration(): void {
  const s = synth();
  if (!s) return;
  const silent = new SpeechSynthesisUtterance(' ');
  silent.volume = 0;
  s.speak(silent);
}

export function narrate(text: string, { urgent = false } = {}): void {
  if (!text) return;
  const ac = getContext();
  if (cloudKey && ac && cloudReady()) narrateWithCloud(ac, cloudKey, text, urgent);
  else speakOnDevice(text, urgent);
}
