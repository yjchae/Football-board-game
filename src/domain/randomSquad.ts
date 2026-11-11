import { REAL_PLAYERS, type LeagueId, type RealPlayer } from '../data/realPlayers';
import { statsFromOverall } from './playerFactory';
import type { Player, Role } from './types';

// ─────────────────────────────────────────────
// 실존 선수 랜덤 뽑기
//  - 고른 리그 안에서 포지션 균형(골키퍼·수비·미드·공격)을 맞춰 뽑는다
//  - 이미 팀에 있는 선수는 다시 뽑지 않는다
//  - 고른 리그에 해당 포지션이 모자라면 다른 리그에서 채운다
// ─────────────────────────────────────────────

export type SquadSize = 1 | 11 | 16;

/** 인원별 포지션 구성 */
const QUOTA: Record<Exclude<SquadSize, 1>, Record<Role, number>> = {
  11: { GK: 1, DF: 4, MF: 3, FW: 3 },
  16: { GK: 2, DF: 5, MF: 5, FW: 4 },
};

const ROLES: Role[] = ['GK', 'DF', 'MF', 'FW'];

type Rng = () => number;

export interface DraftOptions {
  leagues: LeagueId[];
  size: SquadSize;
  /** 이미 팀에 있는 선수 이름 (중복 방지) */
  excludeNames?: string[];
  rng?: Rng;
  pool?: RealPlayer[];
}

export const normalizeName = (name: string) => name.replace(/\s+/g, '').toLowerCase();

/** 피셔-예이츠 섞기 (원본은 그대로 둠) */
function shuffle<T>(list: T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 조건에 맞는 실존 선수를 랜덤으로 뽑는다 (모자라면 뽑힌 만큼만 돌려준다) */
export function draftRandomPlayers({ leagues, size, excludeNames = [], rng = Math.random, pool = REAL_PLAYERS }: DraftOptions): RealPlayer[] {
  const taken = new Set(excludeNames.map(normalizeName));
  const available = pool.filter((p) => !taken.has(normalizeName(p.name)));
  const inLeagues = available.filter((p) => leagues.includes(p.league));
  const others = available.filter((p) => !leagues.includes(p.league));

  if (size === 1) {
    const [first] = shuffle(inLeagues.length ? inLeagues : others, rng);
    return first ? [first] : [];
  }

  const picked: RealPlayer[] = [];
  for (const role of ROLES) {
    const need = QUOTA[size][role];
    const candidates = [
      ...shuffle(inLeagues.filter((p) => p.role === role), rng),
      ...shuffle(others.filter((p) => p.role === role), rng), // 고른 리그에 모자랄 때만 쓰임
    ];
    picked.push(...candidates.slice(0, need));
  }
  return picked;
}

/** 역할별로 먼저 써 볼 등번호 */
const PREFERRED_NUMBERS: Record<Role, number[]> = {
  GK: [1, 12, 25, 31],
  DF: [2, 3, 4, 5, 6, 13, 15, 22, 23],
  MF: [8, 10, 6, 14, 16, 17, 18, 20, 21],
  FW: [9, 7, 11, 19, 27, 29],
};

/** 팀에서 아직 안 쓴 등번호를 골라 준다 */
function nextFreeNumber(role: Role, used: Set<number>): number {
  const preferred = PREFERRED_NUMBERS[role].find((n) => !used.has(n));
  if (preferred !== undefined) return preferred;
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 0;
}

/** 뽑은 실존 선수를 게임용 선수 카드로 바꾼다 (등번호는 팀에서 비어 있는 번호로) */
export function toGamePlayers(drafted: RealPlayer[], usedNumbers: number[] = []): Omit<Player, 'id'>[] {
  const used = new Set(usedNumbers);
  return drafted.map((p) => {
    const number = nextFreeNumber(p.role, used);
    used.add(number);
    return {
      name: p.name,
      number,
      role: p.role,
      position: p.position,
      overall: p.overall,
      stats: statsFromOverall(p.role, p.overall),
    };
  });
}
