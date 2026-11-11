// QA: 경기 진행 상태 머신 회귀 테스트 (QA 1회차에서 찾은 결함 재현 → 수정 확인)
import { describe, expect, it } from 'vitest';
import { buildSegmentContext, contextKey, init, reducer, stateAfterSegment, type MatchState } from './useMatch';
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
  it('R3 선수 정보 없는 부상 이벤트 + 빈자리(퇴장)로 엉뚱한 작전 타임이 걸리지 않음', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    const pid = s.home.lineup.slots.mf1!;
    s = playSegment(s, [ev({ type: 'red', playerId: pid, minute: 2 }), ev({ type: 'injury', playerId: undefined, minute: 8 })]);
    expect(s.phase).toBe('playing');
  });
});

describe('감독 전술 노트 (SET_TACTIC)', () => {
  const toHalftime = (s: MatchState) => {
    s = reducer(s, { type: 'KICKOFF' });
    for (let i = 0; i < 3; i++) s = playSegment(s);
    return s;
  };

  it('경기 전에는 전반 전술만 저장된다', () => {
    let s = reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '  공격적으로!\n측면 크로스  ' });
    expect(s.tactics.home).toEqual({ first: '공격적으로! 측면 크로스' });
    s = reducer(s, { type: 'SET_TACTIC', side: 'away', half: 2, text: '역습' }); // 경기 전 후반 전술 → 무시
    expect(s.tactics.away).toEqual({});
  });

  it('빈 글로 저장하면 미작성, 200자 넘으면 잘린다', () => {
    let s = reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '역습' });
    s = reducer(s, { type: 'SET_TACTIC', side: 'home', half: 1, text: '   ' });
    expect(s.tactics.home.first).toBeUndefined();
    s = reducer(s, { type: 'SET_TACTIC', side: 'home', half: 1, text: '가'.repeat(300) });
    expect(s.tactics.home.first).toHaveLength(200);
  });

  it('경기 중·작전 타임·종료 후에는 무시된다', () => {
    let s = reducer(start(), { type: 'KICKOFF' });
    for (const half of [1, 2] as const) expect(reducer(s, { type: 'SET_TACTIC', side: 'home', half, text: '압박' })).toBe(s);
    s = reducer(s, { type: 'REQUEST_TIMEOUT' });
    s = playSegment(s);
    expect(s.phase).toBe('timeout');
    expect(reducer(s, { type: 'SET_TACTIC', side: 'home', half: 1, text: '압박' })).toBe(s);
  });

  it('하프타임에는 후반 전술만 저장되고, 전반 전술은 그대로', () => {
    let s = reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '수비' });
    s = toHalftime(s);
    expect(reducer(s, { type: 'SET_TACTIC', side: 'home', half: 1, text: '공격' })).toBe(s);
    s = reducer(s, { type: 'SET_TACTIC', side: 'home', half: 2, text: '공격' });
    expect(s.tactics.home).toEqual({ first: '수비', second: '공격' });
  });

  it('엔진에는 현재 하프의 전술 원문만 전달된다', () => {
    let s = reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '수비' });
    s = reducer(s, { type: 'KICKOFF' });
    expect(buildSegmentContext(s).home.tactic).toBe('수비');
    expect(buildSegmentContext(s).away.tactic).toBe('');
    for (let i = 0; i < 3; i++) s = playSegment(s);
    s = reducer(s, { type: 'SET_TACTIC', side: 'away', half: 2, text: '역습' });
    s = reducer(s, { type: 'KICKOFF' });
    const ctx = buildSegmentContext(s);
    expect(ctx.home.tactic).toBe('수비'); // 후반 미작성 → 전반 전술 유지
    expect(ctx.away.tactic).toBe('역습');
  });

  it('후반 전술을 바꾼 팀은 킥오프 때 "바꿨어요" 알림만 (내용은 비공개)', () => {
    let s = reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '수비' });
    s = reducer(s, { type: 'SET_TACTIC', side: 'away', half: 1, text: '압박' });
    s = toHalftime(s);
    s = reducer(s, { type: 'SET_TACTIC', side: 'home', half: 2, text: '공격' });
    s = reducer(s, { type: 'SET_TACTIC', side: 'away', half: 2, text: '압박' }); // 같은 내용 다시 저장
    s = reducer(s, { type: 'KICKOFF' });
    const notes = s.events.filter((e) => e.text.includes('후반 전술을 바꿨어요'));
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain(s.home.team.name);
    expect(notes[0].text).not.toContain('공격');
    expect(notes[0].type).toBe('info');
  });

  it('전술은 미리받기 열쇠에 들어간다 (전술이 다르면 다른 열쇠)', () => {
    const a = reducer(start(), { type: 'KICKOFF' });
    const b = reducer(reducer(start(), { type: 'SET_TACTIC', side: 'home', half: 1, text: '역습' }), { type: 'KICKOFF' });
    expect(contextKey(buildSegmentContext(a))).not.toBe(contextKey(buildSegmentContext(b)));
    // 하프타임 직전 구간에서는 미리받기 대상이 없다 (후반 전술이 정해진 뒤에 요청)
    let h = b;
    for (let i = 0; i < 2; i++) h = playSegment(h);
    h = reducer(reducer(h, { type: 'FETCH_START' }), { type: 'FETCH_DONE', result: { events: [] } });
    expect(stateAfterSegment(h).phase).toBe('halftime');
  });
});
