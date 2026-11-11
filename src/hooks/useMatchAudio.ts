import { useEffect, useRef } from 'react';
import { soundFor } from '../audio/narration';
import { isNarrating, narrate, stopNarration } from '../audio/narrator';
import { playSfx } from '../audio/sfx';
import { scoreOf } from '../domain/match';
import type { MatchEvent } from '../domain/types';

// ─────────────────────────────────────────────
// 경기 화면에 새로 공개된 이벤트마다 효과음·음성 해설을 낸다
// ─────────────────────────────────────────────

interface Options {
  events: MatchEvent[];
  homeName: string;
  awayName: string;
  sfx: boolean;
  voice: boolean;
}

export function useMatchAudio({ events, homeName, awayName, sfx, voice }: Options) {
  const played = useRef(events.length);

  useEffect(() => {
    const fresh = events.slice(played.current);
    played.current = events.length;
    fresh.forEach((event, i) => {
      // 이 이벤트까지의 점수 (한 번에 여러 개가 공개돼도 각자 맞는 점수로)
      const score = scoreOf(events.slice(0, events.length - fresh.length + i + 1));
      const cue = soundFor(event, { homeName, awayName, score });
      if (sfx && cue.sfx) playSfx(cue.sfx);
      if (voice && cue.speech) narrate(cue.speech, { urgent: cue.urgent });
    });
  }, [events, homeName, awayName, sfx, voice]);

  // 해설을 끄거나 경기 화면을 떠나면 바로 멈춘다
  useEffect(() => {
    if (!voice) stopNarration();
  }, [voice]);
  useEffect(() => () => stopNarration(), []);
}

/** 다음 장면을 미뤄야 하는지 (음성 해설이 아직 말하는 중) */
export const narrationBusy = (voice: boolean) => () => voice && isNarrating();
