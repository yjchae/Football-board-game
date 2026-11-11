import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../domain/types';
import { soundFor, stripForSpeech } from './narration';

// ─────────────────────────────────────────────
// 소리 규칙 검증: 어떤 장면에 어떤 효과음·해설이 나가는지
// ─────────────────────────────────────────────

const ctx = { homeName: '번개 FC', awayName: '불꽃 유나이티드', score: { home: 1, away: 0 } };
const ev = (patch: Partial<MatchEvent>): MatchEvent => ({
  id: 'e1',
  minute: 10,
  type: 'chance',
  side: 'home',
  text: '💨 손흥민의 돌파!',
  highlight: false,
  ...patch,
});

describe('stripForSpeech', () => {
  it('이모지·국기·장식 기호를 지우고 공백을 정리한다', () => {
    expect(stripForSpeech('⚽ 골!!  🇰🇷 손흥민 ⭐️')).toBe('골!! 손흥민');
    expect(stripForSpeech('🏴󠁧󠁢󠁥󠁮󠁧󠁿 **대박** 👏🏽')).toBe('대박');
  });
  it('한글·숫자·문장부호는 그대로 둔다', () => {
    expect(stripForSpeech("23분, 슈팅! '골대'를 맞혔어요.")).toBe("23분, 슈팅! '골대'를 맞혔어요.");
  });
});

describe('soundFor', () => {
  it('골: 함성 효과음 + 외침 + 현재 점수, 말하던 해설을 끊는다', () => {
    const cue = soundFor(ev({ type: 'goal', text: '⚽ 손흥민 골!' }), ctx);
    expect(cue.sfx).toBe('goal');
    expect(cue.urgent).toBe(true);
    expect(cue.speech).toContain('손흥민 골!');
    expect(cue.speech).toContain('번개 FC 1 대 0 불꽃 유나이티드');
    expect(cue.speech).not.toMatch(/⚽/);
  });

  it('킥오프·후반 시작은 휘슬, 전반 종료·경기 종료는 각자 휘슬 + 점수 안내', () => {
    expect(soundFor(ev({ type: 'info', side: null, cue: 'kickoff', text: '🎉 킥오프!' }), ctx).sfx).toBe('kickoff');
    expect(soundFor(ev({ type: 'info', side: null, cue: 'second-half', text: '📣 후반전' }), ctx).sfx).toBe('kickoff');
    const half = soundFor(ev({ type: 'info', side: null, cue: 'halftime', text: '⏸️ 전반전 종료 휘슬!' }), ctx);
    expect(half.sfx).toBe('halftime');
    expect(half.speech).toContain('1 대 0');
    const full = soundFor(ev({ type: 'info', side: null, cue: 'fulltime', text: '🏁 경기 종료 휘슬!' }), ctx);
    expect(full.sfx).toBe('fulltime');
    expect(full.urgent).toBe(true);
  });

  it('장면 종류별 효과음: 파울류는 휘슬, 슈팅·선방·돌파·코너킥은 경기 소리', () => {
    const sfxOf = (type: MatchEvent['type']) => soundFor(ev({ type }), ctx).sfx;
    expect(['foul', 'yellow', 'red', 'offside'].map((t) => sfxOf(t as MatchEvent['type']))).toEqual(['foul', 'foul', 'foul', 'foul']);
    expect(sfxOf('shot')).toBe('shot');
    expect(sfxOf('save')).toBe('save');
    expect(sfxOf('chance')).toBe('dribble');
    expect(sfxOf('corner')).toBe('kick');
  });

  it('부상·교체·분위기 장면은 효과음 없이 해설만, 퇴장은 급하게', () => {
    for (const type of ['injury', 'sub', 'info'] as const) expect(soundFor(ev({ type }), ctx).sfx).toBeUndefined();
    const plain = soundFor(ev({}), ctx);
    expect(plain.speech).toBe('손흥민의 돌파!');
    expect(plain.urgent).toBe(false);
    expect(soundFor(ev({ type: 'red', text: '🟥 퇴장!' }), ctx).urgent).toBe(true);
  });

  it('이모지뿐인 문장은 읽지 않는다', () => {
    expect(soundFor(ev({ text: '⚽🔥' }), ctx).speech).toBeUndefined();
  });

  it('오디오가 없는 환경(테스트·서버)에서도 효과음·해설 함수가 오류 없이 지나간다', async () => {
    const { playSfx } = await import('./sfx');
    const { narrate, isNarrating } = await import('./narrator');
    for (const kind of ['goal', 'foul', 'dribble'] as const) expect(() => playSfx(kind)).not.toThrow();
    expect(() => narrate('테스트')).not.toThrow();
    expect(isNarrating()).toBe(false);
  });
});
