import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  buildSideContext,
  computeStats,
  createMatchSide,
  eventId,
  isLastSegmentOfHalf,
  scoreOf,
  SEGMENTS,
  type MatchEngine,
  type MatchSide,
  type SegmentResult,
} from '../domain/match';
import type { HalfSummary, MatchEvent, Side, Team } from '../domain/types';

// ─────────────────────────────────────────────
// 경기 진행 상태 머신
//
//  ready ─(킥오프)→ playing ⇄ timeout(작전타임)
//                     │
//                     ├─(45분)→ halftime ─(후반 시작)→ playing
//                     └─(90분)→ fulltime
// ─────────────────────────────────────────────

export type Phase = 'ready' | 'playing' | 'timeout' | 'halftime' | 'fulltime';

export interface MatchState {
  phase: Phase;
  segIndex: number;
  home: MatchSide;
  away: MatchSide;
  /** 화면에 공개된 이벤트 */
  events: MatchEvent[];
  /** AI가 만들었지만 아직 재생 전인 이벤트 */
  queue: MatchEvent[];
  segmentLoaded: boolean;
  fetching: boolean;
  timeoutRequested: boolean;
  clock: number;
  pendingSummary?: SegmentResult['summary'];
  summaries: HalfSummary[];
  /** 방금 공개된 하이라이트 (연출용) */
  spotlight?: MatchEvent;
  notice?: string;
}

export type Action =
  | { type: 'KICKOFF' }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_DONE'; result: SegmentResult }
  | { type: 'REVEAL' }
  | { type: 'SEGMENT_END' }
  | { type: 'REQUEST_TIMEOUT' }
  | { type: 'RESUME' }
  | { type: 'UPDATE_SIDE'; side: Side; next: MatchSide; log?: string }
  | { type: 'CLEAR_SPOTLIGHT' }
  | { type: 'NOTICE'; text?: string };

export function init(teams: { home: Team; away: Team }): MatchState {
  return {
    phase: 'ready',
    segIndex: 0,
    home: createMatchSide(teams.home),
    away: createMatchSide(teams.away),
    events: [],
    queue: [],
    segmentLoaded: false,
    fetching: false,
    timeoutRequested: false,
    clock: 0,
    summaries: [],
  };
}

/** 이벤트가 공개될 때 경기 상태에 미치는 영향 (퇴장/부상) */
function applyEventEffects(state: MatchState, e: MatchEvent): MatchState {
  if (!e.side || !e.playerId) return state;
  const side = state[e.side];
  if (e.type === 'red') {
    const slots = { ...side.lineup.slots };
    for (const k of Object.keys(slots)) if (slots[k] === e.playerId) slots[k] = null;
    return {
      ...state,
      [e.side]: {
        ...side,
        lineup: { ...side.lineup, slots },
        unavailable: [...side.unavailable, e.playerId],
        sentOff: [...side.sentOff, e.playerId],
      },
    };
  }
  if (e.type === 'injury' && !side.injured.includes(e.playerId)) {
    return { ...state, [e.side]: { ...side, injured: [...side.injured, e.playerId] } };
  }
  return state;
}

function buildHalfSummary(state: MatchState): HalfSummary {
  const half = SEGMENTS[state.segIndex].half;
  const halfEvents = state.events.filter((e) => (half === 1 ? e.minute <= 45 : e.minute > 45));
  const ai = state.pendingSummary;
  const score = scoreOf(state.events);
  return {
    half,
    title: ai?.title ?? `${half === 1 ? '전반전' : '후반전'} 종료`,
    text: ai?.text ?? '',
    mvpPlayerId: ai?.mvpPlayerId,
    score,
    stats: computeStats(halfEvents),
  };
}

export function reducer(state: MatchState, action: Action): MatchState {
  switch (action.type) {
    case 'KICKOFF': {
      // 킥오프는 경기 전/하프타임에만 (버튼 연타로 경기가 처음으로 돌아가는 것 방지)
      if (state.phase !== 'ready' && state.phase !== 'halftime') return state;
      const segIndex = state.phase === 'halftime' ? 3 : 0;
      const minute = SEGMENTS[segIndex].start;
      const info: MatchEvent = {
        id: eventId(),
        minute,
        type: 'info',
        side: null,
        text: segIndex === 0 ? '🎉 킥오프! 경기가 시작됩니다!' : '📣 후반전이 시작됩니다!',
        highlight: false,
      };
      return { ...state, phase: 'playing', segIndex, segmentLoaded: false, clock: minute, events: [...state.events, info] };
    }
    case 'FETCH_START':
      return { ...state, fetching: true };
    case 'FETCH_DONE':
      return {
        ...state,
        fetching: false,
        segmentLoaded: true,
        queue: action.result.events,
        pendingSummary: action.result.summary ?? state.pendingSummary,
      };
    case 'REVEAL': {
      const [next, ...rest] = state.queue;
      if (!next) return state;
      // 이미 퇴장한 선수 관련 이벤트는 건너뛴다
      const gone = next.side && next.playerId && state[next.side].unavailable.includes(next.playerId);
      const base = { ...state, queue: rest, clock: Math.max(state.clock, next.minute) };
      if (gone) return base;
      const applied = applyEventEffects(base, next);
      return {
        ...applied,
        events: [...applied.events, next],
        spotlight: next.highlight ? next : applied.spotlight,
      };
    }
    case 'SEGMENT_END': {
      const seg = SEGMENTS[state.segIndex];
      const atEnd = { ...state, clock: seg.end };
      if (isLastSegmentOfHalf(state.segIndex)) {
        const summary = buildHalfSummary(atEnd);
        const whistle: MatchEvent = {
          id: eventId(),
          minute: seg.end,
          type: 'info',
          side: null,
          text: seg.half === 1 ? '⏸️ 전반전 종료 휘슬!' : '🏁 경기 종료 휘슬!',
          highlight: false,
        };
        return {
          ...atEnd,
          phase: seg.half === 1 ? 'halftime' : 'fulltime',
          timeoutRequested: false,
          summaries: [...state.summaries, summary],
          pendingSummary: undefined,
          events: [...state.events, whistle],
        };
      }
      // 이번 구간에 새로 다친 선수가 경기장에 남아 있으면 자동으로 작전 타임 (한 번만 알림)
      const needsSub = state.events.some(
        (e) =>
          e.type === 'injury' &&
          e.side &&
          e.playerId &&
          e.minute > seg.start &&
          e.minute <= seg.end &&
          Object.values(state[e.side].lineup.slots).includes(e.playerId),
      );
      return {
        ...atEnd,
        segIndex: state.segIndex + 1,
        segmentLoaded: false,
        phase: state.timeoutRequested || needsSub ? 'timeout' : 'playing',
        timeoutRequested: false,
        notice: needsSub && !state.timeoutRequested ? '🚑 부상 선수가 있어요! 교체를 고려해 보세요.' : state.notice,
      };
    }
    case 'REQUEST_TIMEOUT':
      return { ...state, timeoutRequested: true };
    case 'RESUME':
      if (state.phase !== 'timeout') return state;
      return { ...state, phase: 'playing', notice: undefined };
    case 'UPDATE_SIDE': {
      const events = action.log
        ? [
            ...state.events,
            { id: eventId(), minute: state.clock, type: 'sub' as const, side: action.side, text: action.log, highlight: false },
          ]
        : state.events;
      return { ...state, [action.side]: action.next, events };
    }
    case 'CLEAR_SPOTLIGHT':
      return { ...state, spotlight: undefined };
    case 'NOTICE':
      return { ...state, notice: action.text };
  }
}

export function useMatch(teams: { home: Team; away: Team }, engine: MatchEngine, playbackMs: number) {
  const [state, dispatch] = useReducer(reducer, teams, init);
  const requested = useRef<number | null>(null);

  // 1) 구간 이벤트 요청 (React StrictMode 중복 실행 방지)
  useEffect(() => {
    if (state.phase !== 'playing' || state.segmentLoaded || state.fetching) return;
    if (requested.current === state.segIndex) return;
    requested.current = state.segIndex;

    const segment = SEGMENTS[state.segIndex];
    const ctx = {
      segment,
      isLastOfHalf: isLastSegmentOfHalf(state.segIndex),
      home: buildSideContext('home', state.home),
      away: buildSideContext('away', state.away),
      score: scoreOf(state.events),
      history: state.events.filter((e) => e.type !== 'info'),
    };
    dispatch({ type: 'FETCH_START' });
    engine.simulateSegment(ctx).then((result) => dispatch({ type: 'FETCH_DONE', result }));
  }, [state.phase, state.segmentLoaded, state.fetching, state.segIndex, state.home, state.away, state.events, engine]);

  // 2) 이벤트를 하나씩 재생
  useEffect(() => {
    if (state.phase !== 'playing' || !state.segmentLoaded) return;
    const delay = state.queue.length ? playbackMs : playbackMs / 2;
    const timer = setTimeout(() => dispatch({ type: state.queue.length ? 'REVEAL' : 'SEGMENT_END' }), delay);
    return () => clearTimeout(timer);
  }, [state.phase, state.segmentLoaded, state.queue, playbackMs]);

  // 3) 하이라이트 연출은 잠깐만
  useEffect(() => {
    if (!state.spotlight) return;
    const timer = setTimeout(() => dispatch({ type: 'CLEAR_SPOTLIGHT' }), Math.max(1800, playbackMs * 1.5));
    return () => clearTimeout(timer);
  }, [state.spotlight, playbackMs]);

  const actions = {
    kickoff: useCallback(() => dispatch({ type: 'KICKOFF' }), []),
    requestTimeout: useCallback(() => dispatch({ type: 'REQUEST_TIMEOUT' }), []),
    resume: useCallback(() => dispatch({ type: 'RESUME' }), []),
    updateSide: useCallback(
      (side: Side, next: MatchSide, log?: string) => dispatch({ type: 'UPDATE_SIDE', side, next, log }),
      [],
    ),
    notice: useCallback((text?: string) => dispatch({ type: 'NOTICE', text }), []),
  };

  return { state, ...actions };
}
