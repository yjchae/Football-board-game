// QA: 경기 진행 상태 머신 회귀 테스트 (QA 1회차에서 찾은 결함 재현 → 수정 확인)
import { describe, expect, it } from 'vitest';
import { init, reducer, type MatchState } from './useMatch';
import { createDemoTeams } from '../store/demoTeams';
import { eventId, SEGMENTS } from '../domain/match';
import type { MatchEvent } from '../domain/types';

const start = () => { const [home, away] = createDemoTeams(); return init({ home, away }); };
const ev = (p: Partial<MatchEvent>): MatchEvent => ({ id: eventId(), minute: 5, type: 'shot', side: 'home', text: 't', highlight: false, ...p });
function playSegment(s: MatchState, events: MatchEvent[] = []): MatchState {
  s = reducer(s, { type: 'FETCH_START' });
  s = reducer(s, { type: 'FETCH_DONE', result: { events } });
  for (let i = 0; i < events.length; i++) s = reducer(s, { type: 'REVEAL' });
  return reducer(s, { type: 'SEGMENT_END' });
}

describe('경기 진행 상태 머신', () => {
  it('Q1 후반 시작 버튼을 두 번 눌러도 후반이 유지된다', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    for (let i = 0; i < 3; i++) s = playSegment(s);
    expect(s.phase).toBe('halftime');
    s = reducer(s, { type: 'KICKOFF' });
    s = reducer(s, { type: 'KICKOFF' }); // 아이가 두 번 탭
    expect(s.segIndex).toBe(3);
  });
  it('Q1 경기 중 킥오프가 다시 와도 무시된다', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    s = playSegment(s);
    s = reducer(s, { type: 'KICKOFF' });
    expect(s.segIndex).toBe(1);
    expect(s.events.filter((e) => e.text.includes('킥오프')).length).toBe(1);
  });
  it('Q4 부상 알림 작전 타임은 한 번만', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    const pid = s.home.lineup.slots.df1!;
    s = playSegment(s, [ev({ type: 'injury', playerId: pid, minute: 3 })]);
    expect(s.phase).toBe('timeout');
    s = reducer(s, { type: 'RESUME' });
    s = playSegment(s);
    expect(s.phase).toBe('playing'); // 한 번 알렸으면 다시 멈추지 않아야
  });
  it('레드카드 → 10명, 퇴장 기록', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    const pid = s.home.lineup.slots.mf1!;
    s = playSegment(s, [ev({ type: 'red', playerId: pid })]);
    expect(Object.values(s.home.lineup.slots).filter(Boolean)).toHaveLength(10);
    expect(s.home.sentOff).toEqual([pid]);
  });
  it('퇴장한 선수의 이후 골은 무시', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    const pid = s.home.lineup.slots.fw1!;
    s = playSegment(s, [ev({ type: 'red', playerId: pid, minute: 3 }), ev({ type: 'goal', playerId: pid, minute: 9, highlight: true })]);
    expect(s.events.some((e) => e.type === 'goal')).toBe(false);
  });
  it('90분 진행 후 전/후반 정리 2개와 함께 종료', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    for (let i = 0; i < 3; i++) s = playSegment(s);
    s = reducer(s, { type: 'KICKOFF' });
    for (let i = 0; i < 3; i++) s = playSegment(s);
    expect(s.phase).toBe('fulltime');
    expect(s.summaries).toHaveLength(2);
    expect(SEGMENTS[s.segIndex]).toBeDefined();
  });
});
