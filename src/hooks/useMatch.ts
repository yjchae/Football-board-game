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
  type SegmentContext,
  type SegmentResult,
} from '../domain/match';
import { activeTactic, normalizeTactic, type Half, type TacticNote } from '../domain/tactics';
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
  /** 감독 전술 노트 (경기 종료 전까지 화면에 원문을 보여 주지 않는다) */
  tactics: Record<Side, TacticNote>;
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
  | { type: 'NOTICE'; text?: string }
  | { type: 'SET_TACTIC'; side: Side; half: Half; text: string };

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
    tactics: { home: {}, away: {} },
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

// ─────────────── 감독 전술 노트 ───────────────

/** 전반 전술은 경기 전에만, 후반 전술은 하프타임에만 쓸 수 있다 */
function canWriteTactic(phase: Phase, half: Half): boolean {
  return (phase === 'ready' && half === 1) || (phase === 'halftime' && half === 2);
}

function setTactic(state: MatchState, side: Side, half: Half, text: string): MatchState {
  if (!canWriteTactic(state.phase, half)) return state;
  const clean = normalizeTactic(text);
  const note = state.tactics[side];
  // 전반: 빈 글 = 미작성. 후반: 빈 글도 "후반엔 작전 없이"라는 뜻으로 저장한다
  const next: TacticNote = half === 1 ? { ...note, first: clean || undefined } : { ...note, second: clean };
  return { ...state, tactics: { ...state.tactics, [side]: next } };
}

/** 후반 킥오프 때 "전술을 바꿨다"는 사실만 알린다 (내용은 비밀) */
function tacticChangeEvents(state: MatchState, minute: number): MatchEvent[] {
  return (['home', 'away'] as Side[])
    .filter((side) => {
      const { first, second } = state.tactics[side];
      return second !== undefined && second !== (first ?? '');
    })
    .map((side) => ({
      id: eventId(),
      minute,
      type: 'info' as const,
      side: null,
      text: `📋 ${state[side].team.name} 감독이 후반 전술을 바꿨어요!`,
      highlight: false,
    }));
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
      const changed = segIndex === 3 ? tacticChangeEvents(state, minute) : [];
      return { ...state, phase: 'playing', segIndex, segmentLoaded: false, clock: minute, events: [...state.events, info, ...changed] };
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
    case 'SET_TACTIC':
      return setTactic(state, action.side, action.half, action.text);
  }
}

// ─────────────── 다음 구간 미리 받아두기 ───────────────
// AI 응답은 몇 초씩 걸린다. 구간이 끝난 뒤에야 다음 구간을 요청하면
// 매 15분마다 "다음 장면을 만들고 있어요…"에서 경기가 멈춘 것처럼 보인다.
// 그래서 현재 구간을 재생하는 동안 다음 구간을 미리 요청해 둔다.

/** 경기 상태 → 엔진에 넘길 구간 상황 */
export function buildSegmentContext(state: MatchState): SegmentContext {
  const segment = SEGMENTS[state.segIndex];
  return {
    segment,
    isLastOfHalf: isLastSegmentOfHalf(state.segIndex),
    home: buildSideContext('home', state.home, activeTactic(state.tactics.home, segment.half)),
    away: buildSideContext('away', state.away, activeTactic(state.tactics.away, segment.half)),
    score: scoreOf(state.events),
    history: state.events.filter((e) => e.type !== 'info'),
  };
}

/**
 * 미리 받은 결과를 그대로 써도 되는지 비교하는 열쇠 (이벤트 id처럼 매번 달라지는 값은 뺀다)
 * SideContext.tactic(전술 원문)도 들어가므로 전술이 바뀌면 미리 받은 결과는 버려진다.
 */
export function contextKey(ctx: SegmentContext): string {
  return JSON.stringify({
    segment: ctx.segment,
    home: ctx.home,
    away: ctx.away,
    score: ctx.score,
    history: ctx.history.map((e) => [e.minute, e.type, e.side, e.playerId, e.assistId, e.text]),
  });
}

/** 지금 구간을 끝까지 재생했을 때(아무도 끼어들지 않으면)의 상태 */
export function stateAfterSegment(state: MatchState): MatchState {
  let s = state;
  while (s.queue.length) s = reducer(s, { type: 'REVEAL' });
  return reducer(s, { type: 'SEGMENT_END' });
}

interface Prefetch {
  segIndex: number;
  key: string;
  promise: Promise<SegmentResult>;
}

export function useMatch(teams: { home: Team; away: Team }, engine: MatchEngine, playbackMs: number) {
  const [state, dispatch] = useReducer(reducer, teams, init);
  const requested = useRef<number | null>(null);
  const prefetch = useRef<Prefetch | null>(null);

  // 1) 구간 이벤트 요청 (React StrictMode 중복 실행 방지)
  useEffect(() => {
    if (state.phase !== 'playing' || state.segmentLoaded || state.fetching) return;
    if (requested.current === state.segIndex) return;
    requested.current = state.segIndex;

    const ctx = buildSegmentContext(state);
    // 미리 받아둔 결과가 있고, 그 사이 교체 등으로 상황이 바뀌지 않았다면 그대로 쓴다
    const ready = prefetch.current;
    prefetch.current = null;
    const promise =
      ready && ready.segIndex === state.segIndex && ready.key === contextKey(ctx) ? ready.promise : engine.simulateSegment(ctx);

    dispatch({ type: 'FETCH_START' });
    promise.then((result) => dispatch({ type: 'FETCH_DONE', result }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.segmentLoaded, state.fetching, state.segIndex, state.home, state.away, state.events, engine]);

  // 1-2) 현재 구간을 받자마자 다음 구간을 미리 요청
  useEffect(() => {
    if (state.phase !== 'playing' || !state.segmentLoaded) return;
    const nextIndex = state.segIndex + 1;
    if (prefetch.current?.segIndex === nextIndex || requested.current === nextIndex) return;

    const future = stateAfterSegment(state);
    // 하프타임/경기 종료면 다음 요청은 사용자가 "후반 시작"을 누른 뒤에 한다
    if (future.phase !== 'playing' && future.phase !== 'timeout') return;
    if (future.segIndex !== nextIndex || !SEGMENTS[nextIndex]) return;

    const ctx = buildSegmentContext(future);
    prefetch.current = { segIndex: nextIndex, key: contextKey(ctx), promise: engine.simulateSegment(ctx) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.segmentLoaded, state.segIndex, engine]);

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
    setTactic: useCallback(
      (side: Side, half: Half, text: string) => dispatch({ type: 'SET_TACTIC', side, half, text }),
      [],
    ),
  };

  return { state, ...actions };
}
