import { describe, expect, it } from 'vitest';
import { changeFormation, FORMATIONS, onPitchIds } from '../domain/formations';
import { applyDrop, type DropTarget } from '../domain/lineupOps';
import { createLocalEngine, seededRng } from '../domain/localEngine';
import { buildSideContext, isLastSegmentOfHalf, MAX_SUBS, scoreOf, SEGMENTS, type MatchSide } from '../domain/match';
import type { Player, Side, Team } from '../domain/types';
import { createDemoTeams } from '../store/demoTeams';
import { init, reducer, type MatchState } from './useMatch';

// ─────────────────────────────────────────────
// QA 2회차: 무작위 경기 시뮬레이션(퍼즈 테스트)
// 실제 화면에서 일어날 수 있는 행동(교체·위치 이동·포메이션 변경·버튼 연타)을
// 무작위로 섞어 수백 경기를 돌리고, 게임 규칙이 한 번도 깨지지 않는지 본다.
// ─────────────────────────────────────────────

type Rng = () => number;
const pick = <T,>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

/** 화면의 교체 패널(TacticsPanel)과 같은 규칙으로 선수를 옮긴다 */
function tacticalMove(state: MatchState, side: Side, rng: Rng, beforeKickoff: boolean): MatchState {
  const ms = state[side];
  const r = rng();
  if (r < 0.15) {
    const f = pick(FORMATIONS, rng);
    return reducer(state, { type: 'UPDATE_SIDE', side, next: { ...ms, lineup: changeFormation(ms.lineup, ms.team.players, f.id) } });
  }
  const player = pick(ms.team.players, rng);
  const slotIds = Object.keys(ms.lineup.slots);
  const target: DropTarget =
    r < 0.5 ? { kind: 'slot', slotId: pick(slotIds, rng) } : r < 0.85 ? { kind: 'point', point: { x: rng() * 120 - 10, y: rng() * 120 - 10 } } : { kind: 'bench' };
  const result = applyDrop(ms.lineup, player.id, target, {
    matchMode: !beforeKickoff,
    subsLeft: MAX_SUBS - ms.subsUsed,
    maxOnPitch: 11 - ms.sentOff.length,
    unavailable: ms.unavailable,
  });
  if (result.error) return state;
  const next: MatchSide = result.sub
    ? {
        ...ms,
        lineup: result.lineup,
        subsUsed: ms.subsUsed + 1,
        unavailable: [...ms.unavailable, result.sub.outId],
        injured: ms.injured.filter((id) => id !== result.sub!.outId),
      }
    : { ...ms, lineup: result.lineup };
  return reducer(state, { type: 'UPDATE_SIDE', side, next, log: result.sub ? '교체' : undefined });
}

function checkInvariants(s: MatchState, prevClock: number) {
  for (const side of ['home', 'away'] as Side[]) {
    const ms = s[side];
    const ids = onPitchIds(ms.lineup);
    expect(new Set(ids).size, '같은 선수가 두 자리에').toBe(ids.length);
    expect(ids.length, '경기장 인원 초과').toBeLessThanOrEqual(11 - ms.sentOff.length);
    expect(ms.subsUsed, '교체 5회 초과').toBeLessThanOrEqual(MAX_SUBS);
    for (const id of ms.unavailable) expect(ids, '나간 선수가 경기장에').not.toContain(id);
    for (const id of ids) expect(ms.team.players.some((p) => p.id === id), '팀에 없는 선수').toBe(true);
    for (const p of Object.values(ms.lineup.positions ?? {})) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  }
  expect(s.clock, '시계가 뒤로 감').toBeGreaterThanOrEqual(prevClock);
  expect(s.clock).toBeLessThanOrEqual(90);
  const score = scoreOf(s.events);
  expect(score.home + score.away).toBeLessThan(25);
}

async function playFuzzMatch(seed: number, teams: { home: Team; away: Team }) {
  const rng = seededRng(seed);
  const engine = createLocalEngine(seededRng(seed * 7 + 1));
  let s = init(teams);
  let prevClock = 0;
  const step = (fn: (st: MatchState) => MatchState) => {
    s = fn(s);
    checkInvariants(s, prevClock);
    prevClock = s.clock;
  };

  // 킥오프 전 선발 조정
  for (let i = 0; i < 6; i++) step((st) => tacticalMove(st, pick(['home', 'away'] as Side[], rng), rng, true));

  for (let guard = 0; guard < 400 && s.phase !== 'fulltime'; guard++) {
    // 아무 때나 버튼 연타 (화면에서 막히지 않은 동작)
    if (rng() < 0.2) step((st) => reducer(st, { type: 'KICKOFF' }));
    if (rng() < 0.1) step((st) => reducer(st, { type: 'RESUME' }));
    if (rng() < 0.1) step((st) => reducer(st, { type: 'REQUEST_TIMEOUT' }));

    if (s.phase === 'ready' || s.phase === 'halftime') {
      for (let i = 0; i < 4; i++) step((st) => tacticalMove(st, pick(['home', 'away'] as Side[], rng), rng, st.phase === 'ready'));
      step((st) => reducer(st, { type: 'KICKOFF' }));
    } else if (s.phase === 'timeout') {
      for (let i = 0; i < 3; i++) step((st) => tacticalMove(st, pick(['home', 'away'] as Side[], rng), rng, false));
      step((st) => reducer(st, { type: 'RESUME' }));
    } else if (s.phase === 'playing') {
      if (!s.segmentLoaded) {
        const seg = SEGMENTS[s.segIndex];
        const result = await engine.simulateSegment({
          segment: seg,
          isLastOfHalf: isLastSegmentOfHalf(s.segIndex),
          home: buildSideContext('home', s.home),
          away: buildSideContext('away', s.away),
          score: scoreOf(s.events),
          history: s.events.filter((e) => e.type !== 'info'),
        });
        step((st) => reducer(reducer(st, { type: 'FETCH_START' }), { type: 'FETCH_DONE', result }));
      } else if (s.queue.length) {
        step((st) => reducer(st, { type: 'REVEAL' }));
      } else {
        step((st) => reducer(st, { type: 'SEGMENT_END' }));
      }
    }
  }
  return s;
}

describe('무작위 경기 200판 (퍼즈)', () => {
  it('연습용 11+3명 팀', async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const [home, away] = createDemoTeams();
      const s = await playFuzzMatch(seed, { home, away });
      expect(s.phase, `seed ${seed} 경기가 끝나지 않음`).toBe('fulltime');
      expect(s.summaries.map((x) => x.half)).toEqual([1, 2]);
      expect(s.clock).toBe(90);
    }
  });

  it('선수가 7명뿐이고 골키퍼가 없는 팀', async () => {
    const tiny = (t: Team): Team => {
      const players: Player[] = t.players.filter((p) => p.role !== 'GK').slice(0, 7);
      const slots: Record<string, string | null> = {};
      Object.keys(t.lineup.slots).forEach((k, i) => (slots[k] = k === 'gk' ? null : (players[i]?.id ?? null)));
      return { ...t, players, lineup: { ...t.lineup, slots } };
    };
    for (let seed = 1; seed <= 50; seed++) {
      const [home, away] = createDemoTeams();
      const s = await playFuzzMatch(seed, { home: tiny(home), away });
      expect(s.phase).toBe('fulltime');
    }
  });
});
