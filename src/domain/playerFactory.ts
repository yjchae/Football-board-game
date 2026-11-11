import type { PlayerStats, Role } from './types';

// ─────────────────────────────────────────────
// 종합 능력치(OVR) + 역할만으로 세부 능력치를 만들어 주는 도우미
// (연습용 팀 · 랜덤 선수 뽑기에서 함께 사용)
// ─────────────────────────────────────────────

/** 역할별로 OVR에서 얼마나 더하고 뺄지 */
const ROLE_BONUS: Record<Role, PlayerStats> = {
  GK: { pace: -25, shooting: -45, passing: -20, dribbling: -30, defending: -10, physical: -5 },
  DF: { pace: -6, shooting: -30, passing: -10, dribbling: -12, defending: 6, physical: 4 },
  MF: { pace: -4, shooting: -6, passing: 6, dribbling: 4, defending: -15, physical: -6 },
  FW: { pace: 5, shooting: 6, passing: -8, dribbling: 3, defending: -40, physical: -4 },
};

const clampStat = (n: number) => Math.min(99, Math.max(20, Math.round(n)));

export function statsFromOverall(role: Role, overall: number): PlayerStats {
  const bonus = ROLE_BONUS[role];
  return {
    pace: clampStat(overall + bonus.pace),
    shooting: clampStat(overall + bonus.shooting),
    passing: clampStat(overall + bonus.passing),
    dribbling: clampStat(overall + bonus.dribbling),
    defending: clampStat(overall + bonus.defending),
    physical: clampStat(overall + bonus.physical),
  };
}
