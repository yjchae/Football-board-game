import { describe, expect, it } from 'vitest';
import { createDemoTeams } from '../store/demoTeams';
import { getFormation, onPitchIds } from './formations';
import { applyDrop } from './lineupOps';
import { buildSideContext, createMatchSide } from './match';
import { GK_SLOT, labelFor, lineupFromPhoto, photoToPitch, resolveSlots, roleFromY, shapeName } from './positions';
import type { Player, Point } from './types';

// ─────────────────────────────────────────────
// QA: 자유 위치 배치 + 사진 속 카드 배치 → 포지션
// ─────────────────────────────────────────────

const MATCH = { matchMode: true, subsLeft: 5, maxOnPitch: 11, unavailable: [] as string[] };

describe('자유 위치', () => {
  it('위치에 따라 역할과 표기가 정해진다', () => {
    expect(roleFromY(70)).toBe('DF');
    expect(roleFromY(45)).toBe('MF');
    expect(roleFromY(20)).toBe('FW');
    expect(labelFor('DF', { x: 15, y: 70 })).toBe('LB');
    expect(labelFor('MF', { x: 50, y: 55 })).toBe('CDM');
    expect(labelFor('FW', { x: 85, y: 20 })).toBe('RW');
  });

  it('빈 잔디에 놓으면 그 위치로 옮겨지고 역할이 바뀐다', () => {
    const [team] = createDemoTeams();
    const df1 = team.lineup.slots.df1!;
    const r = applyDrop(team.lineup, df1, { kind: 'point', point: { x: 50, y: 20 } }, MATCH);
    expect(r.error).toBeUndefined();
    const slot = resolveSlots(r.lineup).find((s) => s.id === 'df1')!;
    expect([slot.x, slot.y, slot.role]).toEqual([50, 20, 'FW']);
    expect(onPitchIds(r.lineup)).toHaveLength(11); // 인원은 그대로
  });

  it('경기장 밖이나 골키퍼 위치 제한을 지킨다', () => {
    const [team] = createDemoTeams();
    const gk = team.lineup.slots[GK_SLOT]!;
    const r = applyDrop(team.lineup, gk, { kind: 'point', point: { x: 50, y: 10 } });
    const slot = resolveSlots(r.lineup).find((s) => s.id === GK_SLOT)!;
    expect(slot.role).toBe('GK');
    expect(slot.y).toBeGreaterThanOrEqual(80);
    const far = applyDrop(team.lineup, team.lineup.slots.mf1!, { kind: 'point', point: { x: -40, y: 300 } });
    const s2 = resolveSlots(far.lineup).find((s) => s.id === 'mf1')!;
    expect(s2.x).toBeGreaterThanOrEqual(6);
    expect(s2.y).toBeLessThanOrEqual(78);
  });

  it('11명이 다 있으면 벤치 선수를 빈 잔디에 놓을 수 없다', () => {
    const [team] = createDemoTeams();
    const bench = team.players.find((p) => !onPitchIds(team.lineup).includes(p.id))!;
    expect(applyDrop(team.lineup, bench.id, { kind: 'point', point: { x: 50, y: 50 } }, MATCH).error).toBeTruthy();
  });

  it('옮긴 역할이 경기 엔진에도 반영된다 (수비수를 공격 위치로)', () => {
    const [team] = createDemoTeams();
    const df1 = team.lineup.slots.df1!;
    const moved = applyDrop(team.lineup, df1, { kind: 'point', point: { x: 30, y: 15 } }).lineup;
    const ctx = buildSideContext('home', createMatchSide({ ...team, lineup: moved }));
    expect(ctx.onPitch.find((f) => f.player.id === df1)?.slotRole).toBe('FW');
    expect(ctx.formation).toBe(shapeName(moved));
    expect(ctx.formation).toBe('3-3-4');
  });
});

// 사진 속 4-3-3 배치 (사진 좌표 0~1, 골키퍼가 사진 아래쪽)
const PHOTO_433: Point[] = [
  { x: 0.5, y: 0.92 }, // GK
  { x: 0.15, y: 0.7 }, { x: 0.38, y: 0.72 }, { x: 0.62, y: 0.72 }, { x: 0.85, y: 0.7 }, // DF 4
  { x: 0.28, y: 0.48 }, { x: 0.5, y: 0.5 }, { x: 0.72, y: 0.48 }, // MF 3
  { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.15 }, { x: 0.8, y: 0.2 }, // FW 3
];

function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    number: i + 1,
    role: i === 0 ? 'GK' : i <= 4 ? 'DF' : i <= 7 ? 'MF' : 'FW',
    position: '',
    overall: 70 + (i % 5),
    stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
  }));
}

describe('이동 규칙 R1~R4', () => {
  it('R1 골키퍼가 이미 골문 끝(y=80)인데 더 위로 끌면 에러, 라인업 불변', () => {
    const [team] = createDemoTeams();
    const lineup = { ...team.lineup, positions: { gk: { x: 50, y: 80 } } };
    const gk = lineup.slots[GK_SLOT]!;
    const r = applyDrop(lineup, gk, { kind: 'point', point: { x: 50, y: 40 } });
    expect(r.error).toBe('골키퍼는 골문 근처에서만 움직여요');
    expect(r.lineup).toBe(lineup);
  });

  it('R1 필드 선수가 이미 수비 한계(y=78)인데 더 뒤로 끌면 에러', () => {
    const [team] = createDemoTeams();
    const lineup = { ...team.lineup, positions: { df1: { x: 20, y: 78 } } };
    const r = applyDrop(lineup, lineup.slots.df1!, { kind: 'point', point: { x: 20, y: 95 } });
    expect(r.error).toBe('수비 라인 뒤쪽까지만 갈 수 있어요');
  });

  const without = (slotId: string) => {
    const [team] = createDemoTeams();
    const lineup = { ...team.lineup, slots: { ...team.lineup.slots, [slotId]: null } };
    return { team, lineup };
  };

  it('R2 gk만 비었는데 필드 선수를 빈 잔디에 놓으면 에러 (lineup 불변)', () => {
    const { team, lineup } = without(GK_SLOT);
    const bench = team.players.find((p) => !onPitchIds(team.lineup).includes(p.id) && p.role !== 'GK')!;
    const r = applyDrop(lineup, bench.id, { kind: 'point', point: { x: 50, y: 50 } }, { ...MATCH, players: team.players });
    expect(r.error).toContain('골키퍼 자리가 비었어요');
    expect(r.lineup).toBe(lineup);
  });

  it('R3 필드 자리만 비었는데 골키퍼를 빈 잔디에 놓으면 에러, gk가 비었으면 gk 자리로', () => {
    const { team, lineup } = without('mf1');
    const gk2 = { ...team.players[0], id: 'gk2', role: 'GK' as const };
    const players = [...team.players, gk2];
    expect(applyDrop(lineup, 'gk2', { kind: 'point', point: { x: 50, y: 88 } }, { ...MATCH, players }).error).toBeTruthy();
    const noGk = without(GK_SLOT).lineup;
    const ok = applyDrop(noGk, 'gk2', { kind: 'point', point: { x: 50, y: 88 } }, { ...MATCH, players });
    expect(ok.lineup.slots[GK_SLOT]).toBe('gk2');
  });

  it('R2 필드 선수는 gk가 아닌 빈 자리로 들어간다', () => {
    const { team, lineup } = without('mf1');
    const bench = team.players.find((p) => !onPitchIds(team.lineup).includes(p.id) && p.role !== 'GK')!;
    const r = applyDrop(lineup, bench.id, { kind: 'point', point: { x: 40, y: 50 } }, { ...MATCH, players: team.players });
    expect(r.lineup.slots.mf1).toBe(bench.id);
  });

  it('R4 선발 10명·교체 0이어도 빈 슬롯 채우기 가능 (교체 아님)', () => {
    const { team, lineup } = without('mf1');
    const bench = team.players.find((p) => !onPitchIds(team.lineup).includes(p.id))!;
    const r = applyDrop(lineup, bench.id, { kind: 'slot', slotId: 'mf1' }, { ...MATCH, subsLeft: 0 });
    expect(r.error).toBeUndefined();
    expect(r.sub).toBeUndefined();
    expect(r.lineup.slots.mf1).toBe(bench.id);
    // 사람이 서 있는 자리는 여전히 교체 횟수 필요
    const occupied = applyDrop(team.lineup, bench.id, { kind: 'slot', slotId: 'mf1' }, { ...MATCH, subsLeft: 0 });
    expect(occupied.error).toBe('교체 횟수를 모두 사용했어요.');
  });
});

describe('사진 속 카드 배치 → 포지션', () => {
  it('4-3-3으로 놓고 찍으면 4-3-3으로 선다', () => {
    const lineup = lineupFromPhoto(players(11), PHOTO_433, '4-4-2');
    expect(shapeName(lineup)).toBe('4-3-3');
    expect(lineup.formationId).toBe('4-3-3');
    expect(lineup.slots[GK_SLOT]).toBe('p0');
    // 맨 앞 가운데 카드(p9)는 공격수 자리
    const p9 = resolveSlots(lineup).find((s) => lineup.slots[s.id] === 'p9')!;
    expect(p9.role).toBe('FW');
    expect(p9.label).toBe('ST');
  });

  it('사진을 반대 방향(골키퍼가 위)에서 찍어도 같은 모양', () => {
    const flipped = PHOTO_433.map((p) => ({ x: 1 - p.x, y: 1 - p.y }));
    expect(shapeName(lineupFromPhoto(players(11), flipped, '4-4-2'))).toBe('4-3-3');
  });

  it('옆으로(골키퍼가 왼쪽) 찍어도 같은 모양', () => {
    const sideways = PHOTO_433.map((p) => ({ x: 1 - p.y, y: p.x }));
    // 골키퍼가 오른쪽
    expect(shapeName(lineupFromPhoto(players(11), sideways, '4-4-2'))).toBe('4-3-3');
    const otherSide = PHOTO_433.map((p) => ({ x: p.y, y: 1 - p.x }));
    // 골키퍼가 왼쪽
    expect(shapeName(lineupFromPhoto(players(11), otherSide, '4-4-2'))).toBe('4-3-3');
  });

  it('왼쪽 수비 카드는 왼쪽(LB)에 선다', () => {
    const lineup = lineupFromPhoto(players(11), PHOTO_433, '4-4-2');
    const p1 = resolveSlots(lineup).find((s) => lineup.slots[s.id] === 'p1')!;
    expect(p1.label).toBe('LB');
  });

  it('11명이 넘으면 골키퍼 + 능력치 높은 10명, 위치 모르는 카드는 제외', () => {
    const ps = players(14);
    const pts: (Point | undefined)[] = [...PHOTO_433, { x: 0.1, y: 0.95 }, { x: 0.9, y: 0.95 }, undefined];
    const lineup = lineupFromPhoto(ps, pts, '4-3-3');
    const ids = onPitchIds(lineup);
    expect(ids).toHaveLength(11);
    expect(ids).toContain('p0');
    expect(ids).not.toContain('p13');
  });

  it('골키퍼 카드가 없으면 gk 자리는 비우고 아래 카드도 필드 선수', () => {
    const ps = players(11).map((p) => ({ ...p, role: p.role === 'GK' ? ('DF' as const) : p.role }));
    const lineup = lineupFromPhoto(ps, PHOTO_433, '4-3-3');
    expect(lineup.slots[GK_SLOT]).toBeNull();
    expect(onPitchIds(lineup)).toHaveLength(10);
  });

  it('골키퍼 2장이면 능력치 높은 1명만 gk, 나머지는 필드가 모자랄 때만', () => {
    const ps = players(12).map((p, i) => (i === 11 ? { ...p, role: 'GK' as const, overall: 99 } : p));
    const pts: Point[] = [...PHOTO_433, { x: 0.3, y: 0.95 }];
    const lineup = lineupFromPhoto(ps, pts, '4-3-3');
    expect(lineup.slots[GK_SLOT]).toBe('p11'); // OVR 99가 주전 GK
    expect(onPitchIds(lineup)).not.toContain('p0');
    // 필드 10명이 모자라면 남는 GK도 필드에 쓴다
    const few = lineupFromPhoto(players(9), PHOTO_433.slice(0, 9), '4-3-3');
    expect(onPitchIds(few)).toHaveLength(9);
  });

  it('3-4-3 사진 → formationId 3-4-3, 줄 모양 일치, 기본 위치로 바꿔도 역할 유지', () => {
    const pts: Point[] = [
      { x: 0.5, y: 0.92 },
      { x: 0.25, y: 0.72 }, { x: 0.5, y: 0.74 }, { x: 0.75, y: 0.72 },
      { x: 0.12, y: 0.5 }, { x: 0.38, y: 0.5 }, { x: 0.62, y: 0.5 }, { x: 0.88, y: 0.5 },
      { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.15 }, { x: 0.8, y: 0.2 },
    ];
    const lineup = lineupFromPhoto(players(11), pts, '4-4-2');
    expect(lineup.formationId).toBe('3-4-3');
    expect(shapeName(lineup)).toBe('3-4-3');
    // 슬롯 기본 역할과 선 자리의 역할이 같다 (기본 위치 복귀 시 줄이 안 튄다)
    for (const slot of getFormation(lineup.formationId).slots) {
      if (!lineup.slots[slot.id]) continue;
      expect(resolveSlots(lineup).find((s) => s.id === slot.id)!.role).toBe(slot.role);
    }
    // x 순서: 왼쪽 수비 카드(p1)가 df1
    expect(lineup.slots.df1).toBe('p1');
  });

  it('8명 선발이면 모자란 줄은 빈 슬롯', () => {
    const lineup = lineupFromPhoto(players(8), PHOTO_433.slice(0, 8), '4-4-2'); // GK + DF4 + MF3, 공격 0
    expect(onPitchIds(lineup)).toHaveLength(8);
    const empty = Object.keys(lineup.slots).filter((k) => !lineup.slots[k]);
    expect(empty.every((k) => k.startsWith('fw') || k.startsWith('mf') || k.startsWith('m'))).toBe(true);
    expect(empty).toHaveLength(3);
  });

  it('회전 결과는 경기장 범위 안', () => {
    for (const p of photoToPitch(PHOTO_433, 0)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});
