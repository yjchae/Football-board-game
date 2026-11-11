import type { MatchCue, MatchEvent } from '../domain/types';
import type { SfxKind } from './sfx';

// ─────────────────────────────────────────────
// 중계 이벤트 → "소리로 낼 내용" 정하기 (순수 함수라 테스트하기 쉽다)
//
//  - 효과음: 킥오프·후반 시작 휘슬 / 전반 종료 / 경기 종료 / 골 함성
//  - 음성 해설: 화면 문장에서 이모지를 빼고, 골·종료 때는 점수를 덧붙여 더 생생하게
// ─────────────────────────────────────────────

export interface NarrationContext {
  homeName: string;
  awayName: string;
  /** 이 이벤트까지 반영된 점수 */
  score: { home: number; away: number };
}

export interface SoundCue {
  sfx?: SfxKind;
  /** 읽어 줄 문장 (없으면 읽지 않음) */
  speech?: string;
  /** true면 지금 말하던 문장을 끊고 바로 읽는다 (골처럼 중요한 장면) */
  urgent: boolean;
}

const CUE_SFX: Record<MatchCue, SfxKind> = {
  kickoff: 'kickoff',
  'second-half': 'kickoff',
  halftime: 'halftime',
  fulltime: 'fulltime',
};

/** 이모지·장식 기호를 지워서 음성 합성기가 "축구공" 같은 이름을 읽지 않게 한다 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}️‍]/gu, '')
    .replace(/[~*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreLine({ homeName, awayName, score }: NarrationContext): string {
  return `${homeName} ${score.home} 대 ${score.away} ${awayName}.`;
}

/** 골 장면 앞에 붙일 외침 (같은 말만 반복되지 않게 점수로 고른다) */
const GOAL_SHOUTS = ['골! 골! 골입니다!', '들어갔어요! 골입니다!', '골! 그물이 출렁입니다!'];

export function soundFor(event: MatchEvent, ctx: NarrationContext): SoundCue {
  const body = stripForSpeech(event.text);

  if (event.type === 'goal') {
    const shout = GOAL_SHOUTS[(ctx.score.home + ctx.score.away) % GOAL_SHOUTS.length];
    return { sfx: 'goal', speech: `${shout} ${body} ${scoreLine(ctx)}`, urgent: true };
  }

  if (event.cue) {
    const extra = event.cue === 'halftime' || event.cue === 'fulltime' ? ` ${scoreLine(ctx)}` : '';
    return { sfx: CUE_SFX[event.cue], speech: body ? `${body}${extra}` : undefined, urgent: event.cue === 'fulltime' };
  }

  return { speech: body || undefined, urgent: event.type === 'red' };
}
