import { beforeEach, describe, expect, it } from 'vitest';
import { REAL_PLAYERS } from '../data/realPlayers';
import { createDemoTeams } from '../store/demoTeams';
import { DEFAULT_SETTINGS, MAX_CUSTOM_FORMATIONS, useStore } from '../store/useStore';
import { FORMATIONS, buildFormation, getFormation, parseFormationId } from './formations';
import { MAX_SQUAD, searchMarket, swapInTeam } from './market';
import { normalizeName, toGamePlayers } from './randomSquad';
import type { Player } from './types';

describe('포메이션 파싱·생성', () => {
  it('프리셋 8종, 기존 4종은 앞 순서·슬롯 id 불변', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual(['4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '5-3-2', '3-4-3', '4-1-4-1', '4-5-1']);
    expect(getFormation('4-2-3-1').slots.map((s) => s.id)).toEqual(['gk', 'df1', 'df2', 'df3', 'df4', 'dm1', 'dm2', 'mf1', 'mf2', 'mf3', 'fw1']);
    expect(getFormation('4-4-2').slots.find((s) => s.id === 'mf2')).toMatchObject({ x: 40, y: 47 });
  });

  it('규칙: 3~5개, 각 1~6, 합 10', () => {
    expect(parseFormationId('4-1-4-1')).toEqual([4, 1, 4, 1]);
    expect(parseFormationId('2-3-5')).toEqual([2, 3, 5]);
    for (const bad of ['4-4', '4-4-3', '7-2-1', '0-5-5', '1-1-1-1-1-5', '4-4-2-0', '04-4-2', 'abc', '']) {
      expect(parseFormationId(bad)).toBeNull();
    }
  });

  it('직접 만든 모양은 DF 72·FW 18·미드 균등, 슬롯 id 규칙', () => {
    const f = buildFormation([3, 2, 2, 3]);
    expect(f.id).toBe('3-2-2-3');
    expect(f.slots).toHaveLength(11);
    expect(f.slots.map((s) => s.id)).toEqual(['gk', 'df1', 'df2', 'df3', 'm1_1', 'm1_2', 'm2_1', 'm2_2', 'fw1', 'fw2', 'fw3']);
    expect(f.slots.filter((s) => s.role === 'DF').every((s) => s.y === 72)).toBe(true);
    expect(f.slots.filter((s) => s.role === 'FW').every((s) => s.y === 18)).toBe(true);
    expect(getFormation('3-2-2-3').slots).toEqual(f.slots);
  });

  it('모르는 id는 4-4-2, 프리셋과 같은 모양은 프리셋 그대로', () => {
    expect(getFormation('9-9-9').id).toBe('4-4-2');
    expect(buildFormation([4, 4, 2])).toBe(FORMATIONS[0]);
  });
});

const mkPlayer = (i: number): Omit<Player, 'id'> => ({
  name: `선수${i}`, number: i, role: 'MF', position: 'CM', overall: 70,
  stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
});

describe('스토어', () => {
  let teamId: string;
  beforeEach(() => {
    useStore.setState({ teams: [], customFormations: [], settings: DEFAULT_SETTINGS });
    teamId = useStore.getState().addTeam('테스트', '🦁', '#fff');
  });
  const team = () => useStore.getState().teams.find((t) => t.id === teamId)!;

  it('randomDraft 기본값은 true', () => {
    expect(DEFAULT_SETTINGS.randomDraft).toBe(true);
  });

  it('선수는 25명까지만, 남은 자리만큼 추가하고 추가된 수를 돌려준다', () => {
    expect(useStore.getState().addPlayers(teamId, Array.from({ length: 23 }, (_, i) => mkPlayer(i)), { kind: 'none' })).toBe(23);
    expect(useStore.getState().addPlayers(teamId, [mkPlayer(30), mkPlayer(31), mkPlayer(32)], { kind: 'auto' })).toBe(2);
    expect(team().players).toHaveLength(MAX_SQUAD);
    expect(useStore.getState().addPlayer(teamId, mkPlayer(40))).toBe(0);
    expect(team().players).toHaveLength(MAX_SQUAD);
  });

  it('직접 만든 포메이션은 최대 8개(오래된 것부터 삭제), 잘못된 값·프리셋·중복은 무시', () => {
    const s = useStore.getState();
    expect(s.addCustomFormation('4-4-3')).toBe(false);
    expect(s.addCustomFormation('4-4-2')).toBe(false);
    const ids = ['3-3-4', '2-4-4', '3-2-5', '2-2-6', '1-4-5', '1-3-6', '2-3-5', '1-2-3-4', '1-1-4-4'];
    for (const id of ids) useStore.getState().addCustomFormation(id);
    expect(useStore.getState().addCustomFormation('1-1-4-4')).toBe(false);
    expect(useStore.getState().customFormations).toEqual(ids.slice(-MAX_CUSTOM_FORMATIONS));
    useStore.getState().removeCustomFormation('1-1-4-4');
    expect(useStore.getState().customFormations).not.toContain('1-1-4-4');
  });

  it('swapPlayer: 슬롯·등번호·배열 위치 승계, 인원 불변, 옛 id는 사라진다', () => {
    const demo = createDemoTeams()[0];
    useStore.setState({ teams: [{ ...demo, id: teamId, lineup: { ...demo.lineup, positions: { mf1: { x: 33, y: 44 } } } }] });
    const outId = demo.lineup.slots.mf1!;
    const before = team();
    const idx = before.players.findIndex((p) => p.id === outId);
    expect(useStore.getState().swapPlayer(teamId, outId, { ...mkPlayer(99), number: 77 })).toBe(true);
    const after = team();
    expect(after.players).toHaveLength(before.players.length);
    expect(after.players[idx].name).toBe('선수99');
    expect(after.players[idx].number).toBe(before.players[idx].number);
    expect(after.players[idx].id).not.toBe(outId);
    expect(after.lineup.slots.mf1).toBe(after.players[idx].id);
    expect(after.lineup.positions).toEqual({ mf1: { x: 33, y: 44 } });
    expect(Object.values(after.lineup.slots)).not.toContain(outId);
    expect(useStore.getState().swapPlayer(teamId, 'nope', mkPlayer(1))).toBe(false);
  });

  it('26명 팀에서도 교환은 되고 추가만 막힌다', () => {
    const demo = createDemoTeams()[0];
    const extra = Array.from({ length: 26 - demo.players.length }, (_, i) => ({ ...mkPlayer(i), id: `x${i}` }));
    useStore.setState({ teams: [{ ...demo, id: teamId, players: [...demo.players, ...extra] }] });
    expect(team().players).toHaveLength(26);
    expect(useStore.getState().addPlayer(teamId, mkPlayer(1))).toBe(0);
    expect(useStore.getState().swapPlayer(teamId, 'x0', mkPlayer(2))).toBe(true);
    expect(team().players).toHaveLength(26);
  });
});

describe('이적시장', () => {
  it('필터(리그·포지션·이름)와 OVR 내림차순, 내 팀 이름 제외, limit/total', () => {
    const all = searchMarket({ limit: 5 });
    expect(all.players).toHaveLength(5);
    expect(all.total).toBe(REAL_PLAYERS.length);
    const ovrs = all.players.map((p) => p.overall);
    expect(ovrs).toEqual([...ovrs].sort((a, b) => b - a));

    const jgk = searchMarket({ leagues: ['JLEAGUE'], role: 'GK', limit: 100 });
    expect(jgk.players.length).toBeGreaterThan(0);
    expect(jgk.players.every((p) => p.league === 'JLEAGUE' && p.role === 'GK')).toBe(true);

    const found = searchMarket({ query: '김 민 재' });
    expect(found.players.map((p) => p.name)).toContain('김민재');
    expect(searchMarket({ query: '김민재', excludeNames: ['김 민재'] }).total).toBe(0);
  });

  it('swapInTeam은 원본을 바꾸지 않는다', () => {
    const t = createDemoTeams()[0];
    const outId = t.lineup.slots.fw1!;
    const snapshot = JSON.stringify(t);
    const next = swapInTeam(t, outId, toGamePlayers([REAL_PLAYERS[0]])[0], 'new-id')!;
    expect(JSON.stringify(t)).toBe(snapshot);
    expect(next.lineup.slots.fw1).toBe('new-id');
    expect(swapInTeam(t, 'nope', mkPlayer(1), 'z')).toBeNull();
  });
});

describe('리그 데이터', () => {
  it('정규화 이름이 전체에서 유일하고 OVR 1~99', () => {
    const names = REAL_PLAYERS.map((p) => normalizeName(p.name));
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
    expect(REAL_PLAYERS.every((p) => p.overall >= 1 && p.overall <= 99)).toBe(true);
  });

  it('포지션 표기와 역할이 어긋나지 않는다', () => {
    const roleOf = (pos: string) => (pos === 'GK' ? 'GK' : /B$/.test(pos) ? 'DF' : /^(ST|[LR]W|CF)$/.test(pos) ? 'FW' : 'MF');
    const bad = REAL_PLAYERS.filter((p) => !(p.role === roleOf(p.position) || (p.role === 'FW' && p.position === 'CAM')));
    expect(bad.map((p) => p.name)).toEqual([]);
  });
});
