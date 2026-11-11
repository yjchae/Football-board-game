import { describe, expect, it } from 'vitest';
import { createDemoTeams } from '../store/demoTeams';
import { onPitchIds } from './formations';
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

  it('골키퍼 카드가 없으면 가장 아래 카드를 골키퍼로', () => {
    const ps = players(11).map((p) => ({ ...p, role: p.role === 'GK' ? ('DF' as const) : p.role }));
    const lineup = lineupFromPhoto(ps, PHOTO_433, '4-3-3');
    expect(lineup.slots[GK_SLOT]).toBe('p0');
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
