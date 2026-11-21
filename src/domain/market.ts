import { REAL_PLAYERS, type LeagueId, type RealPlayer } from '../data/realPlayers';
import { normalizeName } from './randomSquad';
import type { Player, Role, Team } from './types';

/** 한 팀에 둘 수 있는 최대 선수 수 */
export const MAX_SQUAD = 25;

export interface MarketQuery {
  /** 비우면 모든 리그 */
  leagues?: LeagueId[];
  /** 없으면 모든 포지션 */
  role?: Role;
  /** 이름 검색 (공백 무시, 부분 일치) */
  query?: string;
  /** 내 팀에 이미 있는 선수 이름 (후보에서 제외) */
  excludeNames?: string[];
  /** 돌려줄 최대 개수 (더 보기용) */
  limit?: number;
  pool?: RealPlayer[];
}

/** 이적시장 검색: OVR 내림차순. total은 limit 적용 전 전체 개수 */
export function searchMarket({ leagues = [], role, query = '', excludeNames = [], limit = 30, pool = REAL_PLAYERS }: MarketQuery = {}): {
  players: RealPlayer[];
  total: number;
} {
  const taken = new Set(excludeNames.map(normalizeName));
  const q = normalizeName(query);
  const all = pool
    .filter((p) => (leagues.length === 0 || leagues.includes(p.league)) && (!role || p.role === role))
    .filter((p) => !taken.has(normalizeName(p.name)) && (!q || normalizeName(p.name).includes(q)))
    .sort((a, b) => b.overall - a.overall);
  return { players: all.slice(0, limit), total: all.length };
}

/**
 * 선수 교환(순수): 들어온 선수가 나간 선수의 배열 위치·슬롯(좌표 포함)·등번호를 그대로 물려받는다.
 * 나간 선수가 팀에 없으면 null.
 */
export function swapInTeam(team: Team, outId: string, incoming: Omit<Player, 'id'>, newId: string): Team | null {
  const idx = team.players.findIndex((p) => p.id === outId);
  if (idx < 0) return null;
  const players = [...team.players];
  players[idx] = { ...incoming, id: newId, number: players[idx].number };
  const slots = Object.fromEntries(Object.entries(team.lineup.slots).map(([k, v]) => [k, v === outId ? newId : v]));
  return { ...team, players, lineup: { ...team.lineup, slots } };
}
