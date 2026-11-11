import { onPitchIds } from './formations';
import { GK_SLOT, movePosition } from './positions';
import type { Lineup, Point } from './types';

// ─────────────────────────────────────────────
// 드래그앤드롭/탭 이동 규칙 (순수 함수 → 테스트 가능)
// ─────────────────────────────────────────────

export type DropTarget =
  | { kind: 'slot'; slotId: string } // 다른 선수/자리 위에 놓기 → 자리 바꾸기·교체
  | { kind: 'point'; point: Point } // 빈 잔디 위에 놓기 → 그 위치로 이동
  | { kind: 'bench' };

export interface MoveOptions {
  /** 경기 중이면 교체 규칙이 적용된다 */
  matchMode: boolean;
  subsLeft: number;
  /** 경기장에 설 수 있는 최대 인원 (퇴장 시 줄어듦) */
  maxOnPitch: number;
  /** 다시 투입할 수 없는 선수 (교체아웃/퇴장) */
  unavailable: string[];
}

export interface MoveResult {
  lineup: Lineup;
  /** 교체가 일어났다면 들어온/나간 선수 */
  sub?: { inId: string; outId: string };
  error?: string;
}

const TEAM_MODE: MoveOptions = { matchMode: false, subsLeft: 99, maxOnPitch: 11, unavailable: [] };

function slotOf(lineup: Lineup, playerId: string): string | undefined {
  return Object.keys(lineup.slots).find((k) => lineup.slots[k] === playerId);
}

export function applyDrop(
  lineup: Lineup,
  playerId: string,
  target: DropTarget,
  opts: MoveOptions = TEAM_MODE,
): MoveResult {
  const fail = (error: string): MoveResult => ({ lineup, error });
  if (opts.unavailable.includes(playerId)) return fail('이 선수는 이미 경기에서 나갔어요.');

  const fromSlot = slotOf(lineup, playerId);
  const slots = { ...lineup.slots };

  // ── 벤치로 내리기
  if (target.kind === 'bench') {
    if (!fromSlot) return { lineup };
    if (opts.matchMode) return fail('경기 중에는 벤치 선수를 끌어와서 교체해 주세요.');
    slots[fromSlot] = null;
    return { lineup: { ...lineup, slots } };
  }

  // ── 빈 잔디 위에 놓기
  if (target.kind === 'point') {
    // 경기장 선수: 그 자리로 위치만 이동 (언제나 자유)
    if (fromSlot) return { lineup: movePosition(lineup, fromSlot, target.point) };

    // 벤치 선수: 비어 있는 자리가 있어야 들어갈 수 있다
    const empty = Object.keys(slots).filter((k) => !slots[k]);
    if (empty.length === 0) return fail('경기장에 자리가 없어요. 바꿀 선수 위에 놓아 주세요.');
    // (빈자리를 채우는 것은 교체가 아니라서 교체 횟수는 쓰지 않는다)
    if (opts.matchMode && onPitchIds(lineup).length >= opts.maxOnPitch) {
      return fail('퇴장으로 비어 있는 자리는 채울 수 없어요.');
    }
    const slotId = empty.find((k) => k !== GK_SLOT) ?? empty[0];
    slots[slotId] = playerId;
    return { lineup: movePosition({ ...lineup, slots }, slotId, target.point) };
  }

  const occupant = slots[target.slotId] ?? null;
  if (fromSlot === target.slotId) return { lineup };

  // ── 경기장 안에서 자리 바꾸기 (언제나 자유)
  if (fromSlot) {
    slots[target.slotId] = playerId;
    slots[fromSlot] = occupant;
    return { lineup: { ...lineup, slots } };
  }

  // ── 벤치 → 경기장
  if (opts.matchMode) {
    if (opts.subsLeft <= 0) return fail('교체 횟수를 모두 사용했어요.');
    if (!occupant) {
      const count = onPitchIds(lineup).length;
      if (count >= opts.maxOnPitch) return fail('퇴장으로 비어 있는 자리는 채울 수 없어요.');
    }
  }
  slots[target.slotId] = playerId;
  const result: MoveResult = { lineup: { ...lineup, slots } };
  if (opts.matchMode && occupant) result.sub = { inId: playerId, outId: occupant };
  return result;
}
