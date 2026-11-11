import type { Formation, FormationSlot, Lineup, Player, Role } from './types';

// 좌표 헬퍼: 같은 줄(y)에 n명을 고르게 배치
function row(role: Role, y: number, labels: string[], prefix: string): FormationSlot[] {
  const gap = 100 / (labels.length + 1);
  return labels.map((label, i) => ({
    id: `${prefix}${i + 1}`,
    role,
    label,
    x: Math.round(gap * (i + 1)),
    y,
  }));
}

const GK: FormationSlot = { id: 'gk', role: 'GK', label: 'GK', x: 50, y: 90 };

export const FORMATIONS: Formation[] = [
  {
    id: '4-4-2',
    name: '4-4-2',
    slots: [
      GK,
      ...row('DF', 72, ['LB', 'CB', 'CB', 'RB'], 'df'),
      ...row('MF', 47, ['LM', 'CM', 'CM', 'RM'], 'mf'),
      ...row('FW', 20, ['ST', 'ST'], 'fw'),
    ],
  },
  {
    id: '4-3-3',
    name: '4-3-3',
    slots: [
      GK,
      ...row('DF', 72, ['LB', 'CB', 'CB', 'RB'], 'df'),
      ...row('MF', 48, ['CM', 'CDM', 'CM'], 'mf'),
      ...row('FW', 20, ['LW', 'ST', 'RW'], 'fw'),
    ],
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    slots: [
      GK,
      ...row('DF', 72, ['CB', 'CB', 'CB'], 'df'),
      ...row('MF', 46, ['LWB', 'CM', 'CAM', 'CM', 'RWB'], 'mf'),
      ...row('FW', 20, ['ST', 'ST'], 'fw'),
    ],
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    slots: [
      GK,
      ...row('DF', 74, ['LB', 'CB', 'CB', 'RB'], 'df'),
      ...row('MF', 56, ['CDM', 'CDM'], 'dm'),
      ...row('MF', 36, ['LW', 'CAM', 'RW'], 'mf'),
      ...row('FW', 15, ['ST'], 'fw'),
    ],
  },
];

export function getFormation(id: string): Formation {
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0];
}

/** 빈 라인업 */
export function emptyLineup(formationId = FORMATIONS[0].id): Lineup {
  const slots: Record<string, string | null> = {};
  for (const s of getFormation(formationId).slots) slots[s.id] = null;
  return { formationId, slots };
}

/** 라인업에 서 있는 선수 id 목록 */
export function onPitchIds(lineup: Lineup): string[] {
  return Object.values(lineup.slots).filter((id): id is string => Boolean(id));
}

/**
 * 포메이션 변경: 같은 역할끼리 최대한 자리를 유지하고,
 * 남는 선수는 비슷한 역할의 빈자리로 옮긴다.
 */
export function changeFormation(lineup: Lineup, players: Player[], formationId: string): Lineup {
  const next = emptyLineup(formationId);
  const slots = getFormation(formationId).slots;
  const placed = onPitchIds(lineup);
  const byId = new Map(players.map((p) => [p.id, p]));

  const free = new Set(slots.map((s) => s.id));
  const leftovers: string[] = [];

  for (const pid of placed) {
    const role = byId.get(pid)?.role;
    const match = slots.find((s) => free.has(s.id) && s.role === role);
    if (match) {
      next.slots[match.id] = pid;
      free.delete(match.id);
    } else {
      leftovers.push(pid);
    }
  }
  for (const pid of leftovers) {
    const anyFree = slots.find((s) => free.has(s.id) && s.role !== 'GK');
    if (!anyFree) break;
    next.slots[anyFree.id] = pid;
    free.delete(anyFree.id);
  }
  return next;
}

/** 역할에 맞는 선수를 높은 능력치 순으로 자동 배치 */
export function autoLineup(players: Player[], formationId: string): Lineup {
  const next = emptyLineup(formationId);
  const used = new Set<string>();
  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const slots = getFormation(formationId).slots;

  // 1차: 역할 일치
  for (const slot of slots) {
    const p = sorted.find((pl) => !used.has(pl.id) && pl.role === slot.role);
    if (p) {
      next.slots[slot.id] = p.id;
      used.add(p.id);
    }
  }
  // 2차: 빈 자리 채우기 (GK 자리는 GK만)
  for (const slot of slots) {
    if (next.slots[slot.id] || slot.role === 'GK') continue;
    const p = sorted.find((pl) => !used.has(pl.id) && pl.role !== 'GK');
    if (p) {
      next.slots[slot.id] = p.id;
      used.add(p.id);
    }
  }
  return next;
}
