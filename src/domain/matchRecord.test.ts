import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, pushRecord } from '../store/useStore';
import { createMatchSide } from './match';
import { buildMatchRecord, recordResult } from './matchRecord';
import type { MatchEvent, MatchRecord, Team } from './types';

// ─────────────────────────────────────────────
// 경기 기록: 저장 내용과 "최근 10경기만" 규칙 검증
// ─────────────────────────────────────────────

const team = (id: string, name: string, players: string[]): Team => ({
  id,
  name,
  emoji: '⚡',
  color: '#c6ff3d',
  players: players.map((n, i) => ({
    id: `${id}-${i}`,
    name: n,
    number: i + 1,
    role: 'FW',
    position: 'ST',
    overall: 80,
    stats: { pace: 80, shooting: 80, passing: 80, dribbling: 80, defending: 40, physical: 70 },
  })),
  lineup: { formationId: '4-3-3', slots: {} },
});

const goal = (side: 'home' | 'away', playerId: string, minute: number): MatchEvent => ({
  id: `g${minute}`,
  minute,
  type: 'goal',
  side,
  playerId,
  text: '골!',
  highlight: true,
});

describe('buildMatchRecord', () => {
  const sides = { home: createMatchSide(team('h', '번개 FC', ['손흥민'])), away: createMatchSide(team('a', '불꽃', ['홀란'])) };
  const events = [goal('home', 'h-0', 12), goal('away', 'a-0', 50), goal('home', 'h-0', 88)];

  it('점수·득점자·팀 정보를 복사해 둔다', () => {
    const r = buildMatchRecord('m1', sides, events, new Date('2026-11-11T10:00:00Z'));
    expect(r.score).toEqual({ home: 2, away: 1 });
    expect(r.scorers).toEqual([
      { side: 'home', name: '손흥민', minute: 12 },
      { side: 'away', name: '홀란', minute: 50 },
      { side: 'home', name: '손흥민', minute: 88 },
    ]);
    expect(r.home).toEqual({ name: '번개 FC', emoji: '⚡', color: '#c6ff3d' });
    expect(r.playedAt).toBe('2026-11-11T10:00:00.000Z');
    expect(recordResult(r)).toBe('번개 FC 승리');
  });

  it('무승부와 모르는 득점자도 처리한다', () => {
    const r = buildMatchRecord('m2', sides, [goal('home', 'nobody', 5), goal('away', 'a-0', 6)]);
    expect(recordResult(r)).toBe('무승부');
    expect(r.scorers[0].name).toBe('알 수 없음');
  });
});

describe('pushRecord (최근 경기 기록)', () => {
  const rec = (id: string): MatchRecord => ({
    id,
    playedAt: '2026-11-11T00:00:00.000Z',
    home: { name: 'A', emoji: '⚡', color: '#fff' },
    away: { name: 'B', emoji: '🔥', color: '#000' },
    score: { home: 0, away: 0 },
    scorers: [],
  });

  it('최신 경기가 맨 앞, 최대 10경기만 남긴다', () => {
    let history: MatchRecord[] = [];
    for (let i = 1; i <= 13; i++) history = pushRecord(history, rec(`m${i}`));
    expect(MAX_HISTORY).toBe(10);
    expect(history).toHaveLength(10);
    expect(history[0].id).toBe('m13');
    expect(history.at(-1)!.id).toBe('m4');
  });

  it('같은 경기를 두 번 저장해도 하나만 남는다', () => {
    const history = pushRecord(pushRecord([rec('m1')], rec('m1')), rec('m1'));
    expect(history).toHaveLength(1);
  });
});
