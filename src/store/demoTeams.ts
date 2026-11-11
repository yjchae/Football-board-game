import { autoLineup } from '../domain/formations';
import type { Player, Role, Team } from '../domain/types';
import { uid } from '../utils/id';

// ─────────────────────────────────────────────
// 처음 접속한 아이들이 바로 해볼 수 있는 가상의 연습용 팀 2개
// (실존 선수가 아닌 지어낸 이름)
// ─────────────────────────────────────────────

type Seed = [name: string, num: number, pos: string, role: Role, ovr: number];

function makePlayer([name, number, position, role, overall]: Seed): Player {
  const v = (base: number, bonus: number) => Math.min(99, Math.max(20, Math.round(base + bonus)));
  const o = overall;
  const stats =
    role === 'GK'
      ? { pace: v(o, -25), shooting: v(o, -45), passing: v(o, -20), dribbling: v(o, -30), defending: v(o, -10), physical: v(o, -5) }
      : role === 'DF'
        ? { pace: v(o, -6), shooting: v(o, -30), passing: v(o, -10), dribbling: v(o, -12), defending: v(o, 6), physical: v(o, 4) }
        : role === 'MF'
          ? { pace: v(o, -4), shooting: v(o, -6), passing: v(o, 6), dribbling: v(o, 4), defending: v(o, -15), physical: v(o, -6) }
          : { pace: v(o, 5), shooting: v(o, 6), passing: v(o, -8), dribbling: v(o, 3), defending: v(o, -40), physical: v(o, -4) };
  return { id: uid('p-'), name, number, position, role, overall, stats };
}

function makeTeam(name: string, emoji: string, color: string, seeds: Seed[]): Team {
  const players = seeds.map(makePlayer);
  return { id: uid('team-'), name, emoji, color, players, lineup: autoLineup(players, '4-3-3') };
}

export function createDemoTeams(): Team[] {
  return [
    makeTeam('번개 FC', '⚡', '#c6ff3d', [
      ['한별', 1, 'GK', 'GK', 78],
      ['도윤', 2, 'RB', 'DF', 72],
      ['서준', 4, 'CB', 'DF', 76],
      ['시우', 5, 'CB', 'DF', 74],
      ['하준', 3, 'LB', 'DF', 71],
      ['지호', 6, 'CDM', 'MF', 75],
      ['은우', 8, 'CM', 'MF', 79],
      ['유준', 10, 'CAM', 'MF', 82],
      ['이안', 7, 'RW', 'FW', 80],
      ['로운', 9, 'ST', 'FW', 84],
      ['태오', 11, 'LW', 'FW', 77],
      ['선우', 12, 'CB', 'DF', 68],
      ['민재', 14, 'CM', 'MF', 70],
      ['건우', 19, 'ST', 'FW', 73],
    ]),
    makeTeam('파도 유나이티드', '🦈', '#4dd7ff', [
      ['바다', 1, 'GK', 'GK', 80],
      ['주원', 2, 'RB', 'DF', 73],
      ['우진', 5, 'CB', 'DF', 78],
      ['예준', 6, 'CB', 'DF', 75],
      ['지안', 3, 'LB', 'DF', 70],
      ['도하', 4, 'CDM', 'MF', 77],
      ['연우', 8, 'CM', 'MF', 76],
      ['수호', 10, 'CAM', 'MF', 80],
      ['라온', 7, 'RW', 'FW', 78],
      ['강', 9, 'ST', 'FW', 82],
      ['하람', 11, 'LW', 'FW', 79],
      ['겨울', 13, 'CB', 'DF', 69],
      ['단비', 15, 'CM', 'MF', 71],
      ['새벽', 18, 'ST', 'FW', 74],
    ]),
  ];
}
