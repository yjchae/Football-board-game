import type { Formation, FormationSlot, Lineup, Player, Point, Role } from './types';

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

/** 위치 → 세부 포지션 표기 */
export function labelFor(role: Role, { x, y }: Point): string {
  const side = x < 30 ? 'L' : x > 70 ? 'R' : 'C';
  switch (role) {
    case 'GK':
      return 'GK';
    case 'DF':
      return side === 'C' ? 'CB' : `${side}B`;
    case 'MF':
      if (side !== 'C') return `${side}M`;
      return y >= 52 ? 'CDM' : y <= 42 ? 'CAM' : 'CM';
    case 'FW':
      return side === 'C' ? 'ST' : `${side}W`;
  }
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

/** 직접 입력 가능한 줄 수(3~5)·줄당 인원(1~6)·필드 합계 */
const MIN_ROWS = 3;
const MAX_ROWS = 5;
const MAX_PER_ROW = 6;
const FIELD_PLAYERS = 10;

/** "4-1-4-1" → [4,1,4,1]. 규칙(3~5개, 각 1~6, 합 10)에 안 맞으면 null. 이 규칙은 저장 데이터와의 계약이다. */
export function parseFormationId(id: string): number[] | null {
  if (!/^\d+(-\d+){2,4}$/.test(id)) return null;
  const rows = id.split('-').map(Number);
  const ok =
    rows.length >= MIN_ROWS &&
    rows.length <= MAX_ROWS &&
    rows.every((n) => n >= 1 && n <= MAX_PER_ROW) &&
    rows.reduce((a, b) => a + b, 0) === FIELD_PLAYERS;
  return ok && rows.join('-') === id ? rows : null;
}

/**
 * 줄별 인원([수비, 미드…, 공격])으로 포메이션을 만든다. 같은 id의 프리셋이 있으면 그대로 돌려준다.
 * DF y=72, FW y=18, 미드 줄은 그 사이를 균등 분할. 슬롯 id: gk, df1.., m{줄}_{순번}, fw1..
 */
export function buildFormation(counts: number[]): Formation {
  const id = counts.join('-');
  const preset = FORMATIONS.find((f) => f.id === id);
  if (preset) return preset;
  const mids = counts.length - 2;
  const slots: FormationSlot[] = [GK];
  counts.forEach((n, r) => {
    const role: Role = r === 0 ? 'DF' : r === counts.length - 1 ? 'FW' : 'MF';
    const y = r === 0 ? 72 : role === 'FW' ? 18 : Math.round(72 - (54 * r) / (mids + 1));
    const prefix = role === 'DF' ? 'df' : role === 'FW' ? 'fw' : `m${r}_`;
    const gap = 100 / (n + 1);
    for (let i = 0; i < n; i++) {
      const x = Math.round(gap * (i + 1));
      slots.push({ id: `${prefix}${i + 1}`, role, label: labelFor(role, { x, y }), x, y });
    }
  });
  return { id, name: id, slots };
}

/** 프리셋 → 규칙 문자열 파싱 → 4-4-2 순으로 찾는다 */
export function getFormation(id: string): Formation {
  const found = FORMATIONS.find((f) => f.id === id);
  if (found) return found;
  const rows = parseFormationId(id);
  return rows ? buildFormation(rows) : FORMATIONS[0];
}

// 프리셋 추가분 (기존 4개 뒤에 붙인다 — 순서 변경 금지)
FORMATIONS.push(...[[5, 3, 2], [3, 4, 3], [4, 1, 4, 1], [4, 5, 1]].map(buildFormation));

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
