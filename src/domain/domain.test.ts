import { describe, expect, it } from 'vitest';
import { extractJson, guessRole, sanitizeCard, sanitizeSegment, sanitizeTeamScan } from '../ai/parse';
import { boxToRect } from '../utils/image';
import { friendlyError, isPermanentError } from '../ai/engine';
import { createDemoTeams } from '../store/demoTeams';
import { autoLineup, changeFormation, FORMATIONS, onPitchIds } from './formations';
import { createLocalEngine, seededRng } from './localEngine';
import { applyDrop } from './lineupOps';
import { buildSideContext, computeStats, createMatchSide, scoreOf, SEGMENTS, type SegmentContext } from './match';

// ─────────────────────────────────────────────
// QA: 게임 규칙/AI 응답 검증 단위 테스트
// ─────────────────────────────────────────────

function makeCtx(segIndex = 0, history: SegmentContext['history'] = []): SegmentContext {
  const [home, away] = createDemoTeams();
  return {
    segment: SEGMENTS[segIndex],
    isLastOfHalf: segIndex === 2 || segIndex === 5,
    home: buildSideContext('home', createMatchSide(home)),
    away: buildSideContext('away', createMatchSide(away)),
    score: { home: 0, away: 0 },
    history,
  };
}

describe('포메이션', () => {
  it('모든 포메이션은 GK 1명 포함 11자리', () => {
    for (const f of FORMATIONS) {
      expect(f.slots).toHaveLength(11);
      expect(f.slots.filter((s) => s.role === 'GK')).toHaveLength(1);
      expect(new Set(f.slots.map((s) => s.id)).size).toBe(11);
    }
  });

  it('자동 배치는 11명을 중복 없이 세운다', () => {
    const [team] = createDemoTeams();
    const lineup = autoLineup(team.players, '4-4-2');
    const ids = onPitchIds(lineup);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(11);
  });

  it('포메이션을 바꿔도 선수 수가 유지된다', () => {
    const [team] = createDemoTeams();
    const next = changeFormation(team.lineup, team.players, '3-5-2');
    expect(onPitchIds(next)).toHaveLength(11);
  });
});

describe('드래그앤드롭 규칙', () => {
  const [team] = createDemoTeams();
  const lineup = team.lineup;
  const bench = team.players.find((p) => !onPitchIds(lineup).includes(p.id))!;
  const gkSlot = 'gk';
  const df1 = lineup.slots.df1!;

  it('경기장 안 선수끼리는 자리를 맞바꾼다', () => {
    const r = applyDrop(lineup, df1, { kind: 'slot', slotId: gkSlot });
    expect(r.lineup.slots.gk).toBe(df1);
    expect(r.lineup.slots.df1).toBe(lineup.slots.gk);
  });

  it('경기 중 벤치→경기장은 교체로 기록된다', () => {
    const r = applyDrop(lineup, bench.id, { kind: 'slot', slotId: 'df1' }, { matchMode: true, subsLeft: 5, maxOnPitch: 11, unavailable: [] });
    expect(r.sub).toEqual({ inId: bench.id, outId: df1 });
  });

  it('교체 횟수가 없으면 거절', () => {
    const r = applyDrop(lineup, bench.id, { kind: 'slot', slotId: 'df1' }, { matchMode: true, subsLeft: 0, maxOnPitch: 11, unavailable: [] });
    expect(r.error).toBeTruthy();
    expect(r.lineup).toBe(lineup);
  });

  it('교체아웃된 선수는 다시 들어올 수 없다', () => {
    const r = applyDrop(lineup, bench.id, { kind: 'slot', slotId: 'df1' }, { matchMode: true, subsLeft: 5, maxOnPitch: 11, unavailable: [bench.id] });
    expect(r.error).toBeTruthy();
  });

  it('퇴장으로 빈 자리는 채울 수 없다', () => {
    const redLineup = { ...lineup, slots: { ...lineup.slots, df1: null } };
    const r = applyDrop(redLineup, bench.id, { kind: 'slot', slotId: 'df1' }, { matchMode: true, subsLeft: 5, maxOnPitch: 10, unavailable: [] });
    expect(r.error).toBeTruthy();
  });

  it('팀 관리에서는 벤치로 내릴 수 있다', () => {
    const r = applyDrop(lineup, df1, { kind: 'bench' });
    expect(r.lineup.slots.df1).toBeNull();
  });
});

describe('오프라인 엔진', () => {
  it('구간 범위 안의 이벤트만 만들고, 점수는 이벤트로 계산된다', async () => {
    const engine = createLocalEngine(seededRng(42));
    const ctx = makeCtx(1);
    const { events } = await engine.simulateSegment(ctx);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.minute).toBeGreaterThan(15);
      expect(e.minute).toBeLessThanOrEqual(30);
    }
    const stats = computeStats(events);
    expect(scoreOf(events)).toEqual({ home: stats.home.goals, away: stats.away.goals });
  });

  it('하프 마지막 구간에는 정리가 붙는다', async () => {
    const engine = createLocalEngine(seededRng(7));
    const result = await engine.simulateSegment(makeCtx(2));
    expect(result.summary?.title).toBeTruthy();
  });

  it('90분 전체 경기를 돌려도 점수가 현실적인 범위', async () => {
    const engine = createLocalEngine(seededRng(1));
    let history: SegmentContext['history'] = [];
    for (let i = 0; i < SEGMENTS.length; i++) {
      const r = await engine.simulateSegment(makeCtx(i, history));
      history = [...history, ...r.events];
    }
    const s = scoreOf(history);
    expect(s.home + s.away).toBeLessThan(15);
  });
});

describe('밸런스', () => {
  it('100경기 평균 총 득점이 현실적인 범위(1.5~5골)', async () => {
    const engine = createLocalEngine(seededRng(2024));
    let total = 0;
    for (let g = 0; g < 100; g++) {
      let history: SegmentContext['history'] = [];
      for (let i = 0; i < SEGMENTS.length; i++) {
        history = [...history, ...(await engine.simulateSegment(makeCtx(i, history))).events];
      }
      const s = scoreOf(history);
      total += s.home + s.away;
    }
    const avg = total / 100;
    expect(avg).toBeGreaterThan(1.5);
    expect(avg).toBeLessThan(5);
  });
});

describe('AI 응답 검증', () => {
  it('코드블록으로 감싼 JSON도 꺼낸다', () => {
    expect(extractJson('여기요\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('없는 선수의 골은 버리고, 시간은 구간 안으로 고정', () => {
    const ctx = makeCtx(0);
    const homeStriker = ctx.home.onPitch.find((f) => f.slotRole === 'FW')!.player;
    const r = sanitizeSegment(
      {
        events: [
          { minute: 99, type: 'goal', side: 'home', playerId: homeStriker.id, text: '골!' },
          { minute: 5, type: 'goal', side: 'home', playerId: 'fake-id', text: '가짜 골' },
          { minute: 3, type: 'dance', side: 'home', text: '이상한 타입' },
        ],
      },
      ctx,
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].minute).toBe(15);
    expect(r.events[0].highlight).toBe(true);
  });

  it('팀을 잘못 적은 선수는 실제 소속팀으로 바로잡는다', () => {
    const ctx = makeCtx(0);
    const awayPlayer = ctx.away.onPitch[3].player;
    const r = sanitizeSegment({ events: [{ minute: 4, type: 'shot', side: 'home', playerId: awayPlayer.id, text: '슛' }] }, ctx);
    expect(r.events[0].side).toBe('away');
  });

  it('카드 판독 결과를 안전한 범위로 정리', () => {
    const card = sanitizeCard({ name: 'Test', position: 'st', overall: 150, stats: { pace: -3 } });
    expect(card.role).toBe('FW');
    expect(card.overall).toBe(99);
    expect(card.stats.pace).toBe(1);
    expect(card.stats.shooting).toBe(60);
  });

  it('포지션 표기로 역할 추정', () => {
    expect(guessRole('GK')).toBe('GK');
    expect(guessRole('RB')).toBe('DF');
    expect(guessRole('CAM')).toBe('MF');
    expect(guessRole('LW')).toBe('FW');
  });
});

describe('팀 단체 사진 스캔', () => {
  it('카드 목록을 정리하고 잘못된 영역은 버린다', () => {
    const cards = sanitizeTeamScan({
      cards: [
        { name: 'A', position: 'GK', overall: 80, box: [100, 100, 400, 300] },
        { name: 'B', position: 'ST', overall: 75, box: [500, 500, 490, 600] }, // 뒤집힌 영역
        { name: 'C', position: 'CB', overall: 70, box: 'nope' },
        '카드 아님',
      ],
    });
    expect(cards.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(cards[0].box).toEqual([100, 100, 400, 300]);
    expect(cards[1].box).toBeUndefined();
    expect(cards[2].role).toBe('DF');
  });

  it('배열만 와도 받아들이고, 최대 30장까지만', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `P${i}`, position: 'CM' }));
    expect(sanitizeTeamScan(many)).toHaveLength(30);
    expect(() => sanitizeTeamScan({ foo: 1 })).toThrow();
  });

  it('0~1000 좌표를 픽셀 영역으로 바꾸고 사진 밖으로 넘치지 않는다', () => {
    expect(boxToRect([0, 0, 500, 500], 2000, 1000, 0)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    const r = boxToRect([0, 900, 1000, 1000], 1000, 1000);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y).toBe(0);
  });
});

describe('AI 오류 안내', () => {
  it('무료 한도 0과 일시적 초과, 키 오류를 구분한다', () => {
    const zero = friendlyError(new Error('{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-x","status":"RESOURCE_EXHAUSTED"}}'));
    expect(zero).toContain('한도 0');
    const busy = friendlyError(new Error('{"error":{"code":429,"message":"Resource has been exhausted. Please retry in 30s","status":"RESOURCE_EXHAUSTED"}}'));
    expect(busy).toContain('잠시 후');
    expect(friendlyError(new Error('API key not valid. Please pass a valid API key.'))).toContain('키');
    expect(friendlyError(new Error('models/gemini-old is not found for API version v1beta'))).toContain('모델');
  });
});

describe('AI 오류 재시도 판단', () => {
  it('키 오류·한도 0·없는 모델은 포기, 잠깐 초과·네트워크는 다음에 재시도', () => {
    expect(isPermanentError(new Error('API key not valid'))).toBe(true);
    expect(isPermanentError(new Error('Quota exceeded ... limit: 0, model: x'))).toBe(true);
    expect(isPermanentError(new Error('models/x is not found'))).toBe(true);
    expect(isPermanentError(new Error('429 Resource has been exhausted, retry in 30s'))).toBe(false);
    expect(isPermanentError(new Error('Connection error.'))).toBe(false);
  });
});
