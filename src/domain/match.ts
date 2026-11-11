import { onPitchIds } from './formations';
import { resolveSlots, shapeName } from './positions';
import type {
  EventType,
  Lineup,
  MatchEvent,
  MatchStats,
  Player,
  Role,
  Side,
  SideStats,
  Team,
} from './types';

// ─────────────────────────────────────────────
// 경기 진행 단위: 한 하프를 15분씩 3구간으로 나눠
// 구간 사이마다 "작전 타임(교체/포지션 변경)"을 걸 수 있다.
// ─────────────────────────────────────────────

export interface Segment {
  half: 1 | 2;
  start: number;
  end: number;
}

export const SEGMENTS: Segment[] = [
  { half: 1, start: 0, end: 15 },
  { half: 1, start: 15, end: 30 },
  { half: 1, start: 30, end: 45 },
  { half: 2, start: 45, end: 60 },
  { half: 2, start: 60, end: 75 },
  { half: 2, start: 75, end: 90 },
];

export const MAX_SUBS = 5;

export function isLastSegmentOfHalf(index: number): boolean {
  return index === 2 || index === 5;
}

// ─────────────── 엔진에 넘겨줄 경기 상황 ───────────────

export interface FieldPlayer {
  player: Player;
  slotRole: Role;
  slotLabel: string;
}

export interface SideContext {
  side: Side;
  teamName: string;
  formation: string;
  onPitch: FieldPlayer[];
  bench: Player[];
}

export interface SegmentContext {
  segment: Segment;
  isLastOfHalf: boolean;
  home: SideContext;
  away: SideContext;
  score: { home: number; away: number };
  /** 지금까지의 주요 이벤트 (AI 흐름 유지용) */
  history: MatchEvent[];
}

export interface SegmentResult {
  events: MatchEvent[];
  /** 하프 마지막 구간일 때만: 하프 정리 글 */
  summary?: { title: string; text: string; mvpPlayerId?: string };
}

export interface MatchEngine {
  label: string;
  simulateSegment(ctx: SegmentContext): Promise<SegmentResult>;
}

/** 경기용 라인업 상태 (팀 원본과 분리해서 경기 중에만 바뀜) */
export interface MatchSide {
  team: Team;
  lineup: Lineup;
  subsUsed: number;
  /** 교체되어 나간 선수 / 퇴장 선수 → 다시 들어올 수 없음 */
  unavailable: string[];
  injured: string[];
  /** 퇴장당한 선수 (그만큼 경기장 인원이 줄어든다) */
  sentOff: string[];
}

export function createMatchSide(team: Team): MatchSide {
  return {
    team,
    lineup: structuredClone(team.lineup),
    subsUsed: 0,
    unavailable: [],
    injured: [],
    sentOff: [],
  };
}

export function benchPlayers(side: MatchSide): Player[] {
  const onPitch = new Set(onPitchIds(side.lineup));
  return side.team.players.filter((p) => !onPitch.has(p.id) && !side.unavailable.includes(p.id));
}

export function buildSideContext(side: Side, ms: MatchSide): SideContext {
  const byId = new Map(ms.team.players.map((p) => [p.id, p]));
  const onPitch: FieldPlayer[] = [];
  for (const slot of resolveSlots(ms.lineup)) {
    const pid = ms.lineup.slots[slot.id];
    const player = pid ? byId.get(pid) : undefined;
    if (player) onPitch.push({ player, slotRole: slot.role, slotLabel: slot.label });
  }
  return {
    side,
    teamName: ms.team.name,
    formation: shapeName(ms.lineup),
    onPitch,
    bench: benchPlayers(ms),
  };
}

// ─────────────── 점수/통계 계산 ───────────────
// 점수는 AI가 말한 숫자를 믿지 않고, 항상 이벤트에서 직접 계산한다.

function emptySideStats(): SideStats {
  return { goals: 0, shots: 0, saves: 0, fouls: 0, yellows: 0, reds: 0, corners: 0 };
}

const STAT_KEY: Partial<Record<EventType, keyof SideStats>> = {
  goal: 'goals',
  shot: 'shots',
  save: 'saves',
  foul: 'fouls',
  yellow: 'yellows',
  red: 'reds',
  corner: 'corners',
};

export function computeStats(events: MatchEvent[]): MatchStats {
  const stats: MatchStats = { home: emptySideStats(), away: emptySideStats() };
  for (const e of events) {
    if (!e.side) continue;
    const key = STAT_KEY[e.type];
    if (key) stats[e.side][key] += 1;
    // 골도 슈팅 1개로 집계
    if (e.type === 'goal') stats[e.side].shots += 1;
  }
  return stats;
}

export function scoreOf(events: MatchEvent[]): { home: number; away: number } {
  const s = computeStats(events);
  return { home: s.home.goals, away: s.away.goals };
}

// ─────────────── 능력치 → 팀 전력 ───────────────

/** 포지션이 안 맞으면 능력치가 깎인다 */
export function fitMultiplier(playerRole: Role, slotRole: Role): number {
  if (playerRole === slotRole) return 1;
  if (playerRole === 'GK' || slotRole === 'GK') return 0.5;
  const order: Role[] = ['DF', 'MF', 'FW'];
  const gap = Math.abs(order.indexOf(playerRole) - order.indexOf(slotRole));
  return gap === 1 ? 0.88 : 0.75;
}

export interface TeamPower {
  attack: number;
  midfield: number;
  defense: number;
  keeper: number;
}

function avg(nums: number[], fallback: number): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : fallback;
}

export function teamPower(ctx: SideContext): TeamPower {
  const pick = (role: Role, f: (p: Player) => number) =>
    ctx.onPitch
      .filter((fp) => fp.slotRole === role)
      .map((fp) => f(fp.player) * fitMultiplier(fp.player.role, fp.slotRole));

  const attack = avg(pick('FW', (p) => (p.stats.shooting * 2 + p.stats.pace + p.stats.dribbling) / 4), 35);
  const midfield = avg(pick('MF', (p) => (p.stats.passing * 2 + p.stats.dribbling + p.stats.physical) / 4), 35);
  const defense = avg(pick('DF', (p) => (p.stats.defending * 2 + p.stats.physical + p.stats.pace) / 4), 35);
  const keeper = avg(pick('GK', (p) => p.overall), 25);

  // 인원이 부족하면(퇴장 등) 전체 전력 감소
  const shortHanded = Math.max(0, 11 - ctx.onPitch.length) * 0.06;
  const k = 1 - shortHanded;
  return { attack: attack * k, midfield: midfield * k, defense: defense * k, keeper };
}

/** 이벤트 id 생성 */
let seq = 0;
export function eventId(): string {
  seq += 1;
  return `ev-${Date.now().toString(36)}-${seq}`;
}
