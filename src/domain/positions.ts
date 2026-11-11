import { FORMATIONS, getFormation } from './formations';
import type { FormationSlot, Lineup, Player, Point, Role } from './types';

// ─────────────────────────────────────────────
// 자유 위치 배치
//
// 포메이션은 "처음 서는 자리"일 뿐, 선수는 경기장 어디로든 옮길 수 있다.
// 옮긴 위치(y)에 따라 그 자리의 역할(수비/미드/공격)이 자동으로 정해지고,
// 이 역할이 능력치 보정과 AI 해설에 그대로 쓰인다.
// ─────────────────────────────────────────────

export const GK_SLOT = 'gk';

/** 위치 → 역할 (y가 작을수록 상대 골문 쪽) */
export function roleFromY(y: number): Exclude<Role, 'GK'> {
  if (y >= 62) return 'DF';
  if (y >= 34) return 'MF';
  return 'FW';
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

/** 경기장 밖으로 나가지 않게, 골키퍼는 우리 골문 근처에만 */
export function clampPoint(p: Point, isKeeper: boolean): Point {
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
  return isKeeper ? { x: clamp(p.x, 25, 75), y: clamp(p.y, 80, 94) } : { x: clamp(p.x, 6, 94), y: clamp(p.y, 6, 78) };
}

/** 라인업의 실제 자리 목록 (옮긴 좌표와 그에 따른 역할 반영) */
export function resolveSlots(lineup: Lineup): FormationSlot[] {
  return getFormation(lineup.formationId).slots.map((slot) => {
    const pos = lineup.positions?.[slot.id];
    if (!pos) return slot;
    const role: Role = slot.id === GK_SLOT ? 'GK' : roleFromY(pos.y);
    return { ...slot, x: pos.x, y: pos.y, role, label: labelFor(role, pos) };
  });
}

/** 지금 서 있는 모양을 "4-3-3"처럼 표시 (GK 제외, 선수가 있는 자리만) */
export function shapeName(lineup: Lineup): string {
  const count = { DF: 0, MF: 0, FW: 0 };
  for (const slot of resolveSlots(lineup)) {
    if (slot.role !== 'GK' && lineup.slots[slot.id]) count[slot.role] += 1;
  }
  return `${count.DF}-${count.MF}-${count.FW}`;
}

/** 위치를 옮긴 새 라인업 */
export function movePosition(lineup: Lineup, slotId: string, point: Point): Lineup {
  return {
    ...lineup,
    positions: { ...lineup.positions, [slotId]: clampPoint(point, slotId === GK_SLOT) },
  };
}

// ─────────────── 사진 속 카드 배치 → 라인업 ───────────────

/**
 * 사진에서 찾은 카드 중심점(0~1 비율)을 경기장 좌표로 바꾼다.
 * 골키퍼 카드가 있는 쪽을 "우리 골문(아래)"으로 보고 사진을 돌린다.
 * (사진을 어느 방향에서 찍어도 됨)
 */
export function photoToPitch(points: Point[], keeperIndex: number): Point[] {
  if (points.length === 0) return [];
  const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
  const rel = points.map((p) => ({ x: p.x - cx, y: p.y - cy }));

  // 골키퍼 방향을 아래쪽(+y)으로 돌리는 90도 단위 회전
  const g = rel[keeperIndex] ?? rel.reduce((a, b) => (b.y > a.y ? b : a));
  const rotate: (p: Point) => Point =
    Math.abs(g.y) >= Math.abs(g.x)
      ? g.y >= 0
        ? (p) => p // 골키퍼가 아래
        : (p) => ({ x: -p.x, y: -p.y }) // 위 → 180도
      : g.x < 0
        ? (p) => ({ x: p.y, y: -p.x }) // 왼쪽 → 아래
        : (p) => ({ x: -p.y, y: p.x }); // 오른쪽 → 아래
  const r = rel.map(rotate);

  // 경기장 크기에 맞게 늘리기 (골키퍼는 맨 아래 고정, 필드 선수만으로 범위를 잡는다)
  const field = r.filter((_, i) => i !== keeperIndex);
  const xs = (field.length ? field : r).map((p) => p.x);
  const ys = (field.length ? field : r).map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit = (v: number, lo: number, hi: number, outLo: number, outHi: number) =>
    hi - lo < 1e-6 ? (outLo + outHi) / 2 : outLo + ((v - lo) / (hi - lo)) * (outHi - outLo);

  return r.map((p, i) =>
    i === keeperIndex
      ? { x: 50, y: 90 }
      : { x: Math.round(fit(p.x, minX, maxX, 12, 88)), y: Math.round(fit(p.y, minY, maxY, 14, 76)) },
  );
}

/**
 * 카드 배치대로 라인업 만들기.
 * players[i] 의 사진 속 위치가 points[i] (위치를 모르는 카드는 undefined).
 * 11명이 넘으면 골키퍼 + 능력치 높은 10명을 선발로 세운다.
 */
export function lineupFromPhoto(players: Player[], points: (Point | undefined)[], formationId: string): Lineup {
  const placed = players.map((p, i) => ({ player: p, point: points[i] })).filter((c): c is { player: Player; point: Point } => !!c.point);

  const keeper = placed.filter((c) => c.player.role === 'GK').sort((a, b) => b.player.overall - a.player.overall)[0]
    ?? placed.reduce<(typeof placed)[number] | undefined>((a, b) => (!a || b.point.y > a.point.y ? b : a), undefined);
  const field = placed
    .filter((c) => c !== keeper)
    .sort((a, b) => b.player.overall - a.player.overall)
    .slice(0, keeper ? 10 : 11);
  const chosen = keeper ? [keeper, ...field] : field;

  const pitch = photoToPitch(chosen.map((c) => c.point), keeper ? 0 : -1);

  // 모양에 가장 가까운 기본 포메이션을 고른다 (버튼 표시용)
  const fieldPoints = pitch.slice(keeper ? 1 : 0);
  const want = { DF: 0, MF: 0, FW: 0 };
  for (const p of fieldPoints) want[roleFromY(p.y)] += 1;
  const formation =
    FORMATIONS.find((f) => {
      const c = { DF: 0, MF: 0, FW: 0 };
      for (const s of f.slots) if (s.role !== 'GK') c[s.role] += 1;
      return c.DF === want.DF && c.MF === want.MF && c.FW === want.FW;
    }) ?? getFormation(formationId);

  const slots: Record<string, string | null> = {};
  for (const s of formation.slots) slots[s.id] = null;
  const positions: Record<string, Point> = {};
  const fieldSlotIds = formation.slots.filter((s) => s.id !== GK_SLOT).map((s) => s.id);

  chosen.forEach((c, i) => {
    const slotId = keeper && i === 0 ? GK_SLOT : fieldSlotIds.shift();
    if (!slotId) return;
    slots[slotId] = c.player.id;
    positions[slotId] = clampPoint(pitch[i], slotId === GK_SLOT);
  });
  return { formationId: formation.id, slots, positions };
}
