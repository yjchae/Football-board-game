// ─────────────────────────────────────────────
// 음성 해설 — 브라우저 내장 음성 합성(Web Speech API) 사용
//
//  - 한국어(ko-KR) 목소리가 있으면 그 목소리로, 없으면 기본 목소리로 읽는다
//  - 밀린 문장이 쌓이지 않게 "대기 문장은 최대 1개"만 남긴다
//  - 골처럼 급한 장면(urgent)은 말하던 것을 끊고 바로 읽는다
// ─────────────────────────────────────────────

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

function koreanVoice(s: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const voices = s.getVoices();
  return voices.find((v) => v.lang === 'ko-KR') ?? voices.find((v) => v.lang.toLowerCase().startsWith('ko'));
}

/**
 * 마지막 문장이 늦어도 이때까지는 끝났다고 보는 시각.
 * 목소리가 없는 기기에서는 speaking 값이 계속 true로 남거나 onend가 오지 않을 수 있어서
 * 문장 길이로 낭독 시간을 넉넉히 어림잡아 그 이상은 기다리지 않는다.
 */
let speakingUntil = 0;

/** 한국어 낭독 시간 어림값: 글자당 약 0.13초 + 여유 1초 */
export const estimateSpeechMs = (text: string) => 1000 + text.length * 130;

/** 지금 읽고 있는 문장이 있는지 */
export function isNarrating(): boolean {
  const s = synth();
  return !!s && (s.speaking || s.pending) && Date.now() < speakingUntil;
}

/** 읽던 문장과 대기 문장을 모두 멈춘다 */
export function stopNarration(): void {
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
  const s = synth();
  if (!s || !text) return;
  // 급한 장면이거나 이미 한 문장이 대기 중이면 밀린 해설을 버린다
  if (urgent || s.pending) stopNarration();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const voice = koreanVoice(s);
  if (voice) u.voice = voice;
  // 골 장면은 조금 더 빠르고 높게 → 흥분한 해설 느낌
  u.rate = urgent ? 1.15 : 1.05;
  u.pitch = urgent ? 1.25 : 1.05;
  speakingUntil = Math.max(speakingUntil, Date.now()) + estimateSpeechMs(text);
  u.onend = u.onerror = () => {
    if (!s.speaking && !s.pending) speakingUntil = 0;
  };
  s.speak(u);
}
