import { describe, expect, it } from 'vitest';
import { LEAGUES, REAL_PLAYERS } from '../data/realPlayers';
import { seededRng } from './localEngine';
import { draftRandomPlayers, normalizeName, toGamePlayers } from './randomSquad';

// ─────────────────────────────────────────────
// 실존 선수 랜덤 뽑기 검증
// ─────────────────────────────────────────────

const countRoles = (list: { role: string }[]) =>
  list.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.role]: (acc[p.role] ?? 0) + 1 }), {});

describe('실존 선수 명단', () => {
  it('이름이 겹치지 않는다', () => {
    const names = REAL_PLAYERS.map((p) => normalizeName(p.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('리그마다 11명 선발(GK1·DF4·MF3·FW3)을 채울 만큼 선수가 있다', () => {
    for (const league of LEAGUES) {
      const roles = countRoles(REAL_PLAYERS.filter((p) => p.league === league.id));
      expect(roles.GK).toBeGreaterThanOrEqual(1);
      expect(roles.DF).toBeGreaterThanOrEqual(4);
      expect(roles.MF).toBeGreaterThanOrEqual(3);
      expect(roles.FW).toBeGreaterThanOrEqual(3);
    }
  });

  it('5개 리그 모두 선수가 있고 OVR은 1~99 사이', () => {
    for (const league of LEAGUES) expect(REAL_PLAYERS.some((p) => p.league === league.id)).toBe(true);
    for (const p of REAL_PLAYERS) expect(p.overall).toBeGreaterThanOrEqual(1), expect(p.overall).toBeLessThanOrEqual(99);
  });
});

describe('draftRandomPlayers', () => {
  it('11명은 GK1·DF4·MF3·FW3, 중복 없음', () => {
    const squad = draftRandomPlayers({ leagues: ['EPL'], size: 11, rng: seededRng(1) });
    expect(squad).toHaveLength(11);
    expect(countRoles(squad)).toEqual({ GK: 1, DF: 4, MF: 3, FW: 3 });
    expect(new Set(squad.map((p) => p.name)).size).toBe(11);
    expect(squad.every((p) => p.league === 'EPL')).toBe(true);
  });

  it('16명은 GK2·DF5·MF5·FW4', () => {
    const squad = draftRandomPlayers({ leagues: ['LALIGA', 'LIGUE1'], size: 16, rng: seededRng(7) });
    expect(countRoles(squad)).toEqual({ GK: 2, DF: 5, MF: 5, FW: 4 });
  });

  it('이미 팀에 있는 선수는 뽑지 않는다', () => {
    const exclude = REAL_PLAYERS.filter((p) => p.league === 'MLS').map((p) => p.name).slice(0, 10);
    for (let seed = 0; seed < 20; seed++) {
      const squad = draftRandomPlayers({ leagues: ['MLS'], size: 11, excludeNames: exclude, rng: seededRng(seed) });
      expect(squad.some((p) => exclude.includes(p.name))).toBe(false);
    }
  });

  it('고른 리그에 포지션이 모자라면 다른 리그에서 채운다', () => {
    // MLS 골키퍼를 1명만 남긴 작은 명단 → 16명(골키퍼 2명)을 뽑으면 1명은 다른 리그에서
    const pool = REAL_PLAYERS.filter((p) => p.league !== 'MLS' || p.role !== 'GK' || p.name === '위고 요리스');
    const squad = draftRandomPlayers({ leagues: ['MLS'], size: 16, rng: seededRng(3), pool });
    expect(squad).toHaveLength(16);
    const keepers = squad.filter((p) => p.role === 'GK');
    expect(keepers.map((p) => p.league).sort()).not.toEqual(['MLS', 'MLS']);
    expect(keepers.some((p) => p.name === '위고 요리스')).toBe(true);
  });

  it('1명 뽑기', () => {
    const [one, ...rest] = draftRandomPlayers({ leagues: ['KLEAGUE'], size: 1, rng: seededRng(5) });
    expect(rest).toHaveLength(0);
    expect(one.league).toBe('KLEAGUE');
  });
});

describe('toGamePlayers', () => {
  it('팀에서 쓰는 등번호는 피하고 서로 겹치지 않게 붙인다', () => {
    const squad = draftRandomPlayers({ leagues: ['EPL'], size: 16, rng: seededRng(2) });
    const players = toGamePlayers(squad, [1, 9, 10]);
    const numbers = players.map((p) => p.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.some((n) => [1, 9, 10].includes(n))).toBe(false);
    expect(players.every((p) => p.stats.pace >= 20 && p.stats.pace <= 99)).toBe(true);
  });
});
