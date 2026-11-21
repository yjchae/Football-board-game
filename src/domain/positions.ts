import { FORMATIONS, buildFormation, emptyLineup, getFormation, labelFor } from './formations';
export { labelFor };
import type { Formation, FormationSlot, Lineup, Player, Point, Role } from './types';

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

/** 이 이동이 clamp 때문에 사실상 제자리(3% 미만)가 되면 에러 문구, 아니면 null */
export function blockedMoveError(lineup: Lineup, slotId: string, point: Point): string | null {
  const isKeeper = slotId === GK_SLOT;
  const from = lineup.positions?.[slotId] ?? getFormation(lineup.formationId).slots.find((s) => s.id === slotId);
  if (!from) return null;
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const stuck = dist(clampPoint(point, isKeeper), from) < 3 && dist(point, from) >= 3;
  if (!stuck) return null;
  return isKeeper ? '골키퍼는 골문 근처에서만 움직여요' : '수비 라인 뒤쪽까지만 갈 수 있어요';
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

const LINES = ['DF', 'MF', 'FW'] as const;

const lineCounts = (f: Formation) => LINES.map((r) => f.slots.filter((s) => s.role === r).length);

/** 줄별 인원이 규칙에 맞으면 그 모양, 아니면 가장 가까운 프리셋 */
function formationFor(want: number[]): Formation {
  const sum = want.reduce((a, b) => a + b, 0);
  if (sum === 10 && want.every((n) => n >= 1 && n <= 6)) return buildFormation(want);
  const gap = (f: Formation) => lineCounts(f).reduce((a, n, i) => a + Math.abs(n - want[i]), 0);
  return FORMATIONS.reduce((best, f) => (gap(f) < gap(best) ? f : best));
}

/**
 * 카드 배치대로 라인업 만들기.
 * players[i] 의 사진 속 위치가 points[i] (위치를 모르는 카드는 undefined).
 * 골키퍼 카드가 없으면 gk 자리는 비우고, 골키퍼가 여럿이면 능력치 높은 1명만 gk, 나머지는 필드가 모자랄 때만 쓴다.
 * 필드는 최대 10명 (능력치 높은 순). 줄(수비/미드/공격)별로 같은 역할 자리에 x 순서대로 세운다.
 */
export function lineupFromPhoto(players: Player[], points: (Point | undefined)[], formationId: string): Lineup {
  const placed = players.map((p, i) => ({ player: p, point: points[i] })).filter((c): c is { player: Player; point: Point } => !!c.point);
  const byOvr = (a: (typeof placed)[number], b: (typeof placed)[number]) => b.player.overall - a.player.overall;

  const [keeper, ...extraKeepers] = placed.filter((c) => c.player.role === 'GK').sort(byOvr);
  const field = [...placed.filter((c) => c.player.role !== 'GK').sort(byOvr), ...extraKeepers].slice(0, 10);
  const chosen = keeper ? [keeper, ...field] : field;
  if (chosen.length === 0) return emptyLineup(formationId);

  const pitch = photoToPitch(chosen.map((c) => c.point), keeper ? 0 : -1);
  const fieldOffset = keeper ? 1 : 0;
  const entries = field.map((c, i) => ({ id: c.player.id, ovr: c.player.overall, pt: clampPoint(pitch[i + fieldOffset], false) }));

  // 줄(y) → 역할별 묶음
  const groups: Record<(typeof LINES)[number], typeof entries> = { DF: [], MF: [], FW: [] };
  for (const e of entries) groups[roleFromY(e.pt.y) as (typeof LINES)[number]].push(e);
  const formation = formationFor(LINES.map((r) => groups[r].length));

  const slots: Record<string, string | null> = {};
  for (const s of formation.slots) slots[s.id] = null;
  const positions: Record<string, Point> = {};
  const put = (slotId: string, e: { id: string; pt: Point }) => {
    slots[slotId] = e.id;
    positions[slotId] = e.pt;
  };

  if (keeper) put(GK_SLOT, { id: keeper.player.id, pt: clampPoint(pitch[0], true) });

  const overflow: typeof entries = [];
  for (const role of LINES) {
    const roleSlots = formation.slots.filter((s) => s.role === role).sort((a, b) => a.x - b.x);
    const group = [...groups[role]];
    if (group.length > roleSlots.length) {
      group.sort((a, b) => b.ovr - a.ovr);
      overflow.push(...group.splice(roleSlots.length));
    }
    group.sort((a, b) => a.pt.x - b.pt.x);
    // 모자라면 자리를 고르게 골라 나머지를 빈 슬롯으로 둔다
    group.forEach((e, i) => {
      const idx = group.length === 1 ? Math.floor((roleSlots.length - 1) / 2) : Math.round((i * (roleSlots.length - 1)) / (group.length - 1));
      put(roleSlots[idx].id, e);
    });
  }
  for (const e of overflow) {
    const free = formation.slots.find((s) => s.id !== GK_SLOT && !slots[s.id]);
    if (free) put(free.id, e);
  }
  return { formationId: formation.id, slots, positions };
}
