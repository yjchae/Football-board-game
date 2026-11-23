import type { EventType, MatchCue, MatchEvent, VoiceLang } from '../domain/types';
import type { SfxKind } from './sfx';

// ─────────────────────────────────────────────
// 중계 이벤트 → "소리로 낼 내용" 정하기 (순수 함수라 테스트하기 쉽다)
//
//  - 효과음: 시작·종료 휘슬 / 골 함성 / 파울 휘슬 / 슈팅·킥·드리블 소리 / 선방 탄성
//  - 음성 해설: 화면 문장에서 이모지를 빼고, 골·종료 때는 점수를 덧붙여 더 생생하게
//  - 화면에는 한국어·영어가 함께 나오지만, 소리로는 고른 언어(lang) 하나만 읽는다
// ─────────────────────────────────────────────

export interface NarrationContext {
  homeName: string;
  awayName: string;
  /** 이 이벤트까지 반영된 점수 */
  score: { home: number; away: number };
  /** 읽어 줄 언어 (기본 한국어) */
  lang?: VoiceLang;
}

export interface SoundCue {
  sfx?: SfxKind;
  /** 읽어 줄 문장 (없으면 읽지 않음) */
  speech?: string;
  /** true면 지금 말하던 문장을 끊고 바로 읽는다 (골처럼 중요한 장면) */
  urgent: boolean;
  /** speech를 읽을 언어 */
  lang: VoiceLang;
}

const CUE_SFX: Record<MatchCue, SfxKind> = {
  kickoff: 'kickoff',
  'second-half': 'kickoff',
  halftime: 'halftime',
  fulltime: 'fulltime',
};

/** 일반 장면 종류 → 효과음 (없는 장면은 해설만) */
const TYPE_SFX: Partial<Record<EventType, SfxKind>> = {
  foul: 'foul',
  yellow: 'foul',
  red: 'foul',
  offside: 'foul',
  shot: 'shot',
  save: 'save',
  chance: 'dribble',
  corner: 'kick',
};

/** 이모지·장식 기호를 지워서 음성 합성기가 "축구공" 같은 이름을 읽지 않게 한다 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}️‍]/gu, '')
    .replace(/[~*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreLine({ homeName, awayName, score, lang = 'ko' }: NarrationContext): string {
  return lang === 'en'
    ? `${homeName} ${score.home}, ${awayName} ${score.away}.`
    : `${homeName} ${score.home} 대 ${score.away} ${awayName}.`;
}

/** 골 장면 앞에 붙일 외침 (같은 말만 반복되지 않게 점수로 고른다) */
const GOAL_SHOUTS: Record<VoiceLang, string[]> = {
  ko: ['골! 골! 골입니다!', '들어갔어요! 골입니다!', '골! 그물이 출렁입니다!'],
  en: ['Goal! Goal! Goal!', "It's in! What a goal!", 'GOAL! The net is bulging!'],
};

/** 실제로 읽게 될 언어 (영어를 골라도 영어 해설이 없는 장면은 한국어로 읽는다) */
export const spokenLang = (event: MatchEvent, lang: VoiceLang = 'ko'): VoiceLang => (lang === 'en' && event.textEn ? 'en' : 'ko');

export function soundFor(event: MatchEvent, input: NarrationContext): SoundCue {
  const lang = spokenLang(event, input.lang);
  const ctx = { ...input, lang };
  const body = stripForSpeech(lang === 'en' ? event.textEn! : event.text);

  if (event.type === 'goal') {
    const shouts = GOAL_SHOUTS[lang];
    const shout = shouts[(ctx.score.home + ctx.score.away) % shouts.length];
    return { sfx: 'goal', speech: `${shout} ${body} ${scoreLine(ctx)}`, urgent: true, lang };
  }

  if (event.cue) {
    const extra = event.cue === 'halftime' || event.cue === 'fulltime' ? ` ${scoreLine(ctx)}` : '';
    return { sfx: CUE_SFX[event.cue], speech: body ? `${body}${extra}` : undefined, urgent: event.cue === 'fulltime', lang };
  }

  return { sfx: TYPE_SFX[event.type], speech: body || undefined, urgent: event.type === 'red', lang };
}
