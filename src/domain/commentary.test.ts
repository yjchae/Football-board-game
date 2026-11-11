import { describe, expect, it } from 'vitest';
import { createDemoTeams } from '../store/demoTeams';
import { josa } from '../utils/josa';
import { Commentator, goalSituation } from './commentary';
import { createLocalEngine, seededRng } from './localEngine';
import { buildSideContext, createMatchSide, scoreOf, SEGMENTS } from './match';
import type { MatchEvent } from './types';

// ─────────────────────────────────────────────
// QA: 오프라인 엔진 해설 문장 테스트
// ─────────────────────────────────────────────

async function playMatch(seed: number): Promise<MatchEvent[]> {
  const [home, away] = createDemoTeams();
  const engine = createLocalEngine(seededRng(seed));
  let history: MatchEvent[] = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const r = await engine.simulateSegment({
      segment: SEGMENTS[i],
      isLastOfHalf: i === 2 || i === 5,
      home: buildSideContext('home', createMatchSide(home)),
      away: buildSideContext('away', createMatchSide(away)),
      score: scoreOf(history),
      history,
    });
    history = [...history, ...r.events];
  }
  return history;
}

describe('조사', () => {
  it('받침에 맞는 조사를 붙인다', () => {
    expect(josa('한별', '이/가')).toBe('한별이');
    expect(josa('바다', '이/가')).toBe('바다가');
    expect(josa('로운', '을/를')).toBe('로운을');
    expect(josa('수호', '과/와')).toBe('수호와');
    expect(josa('은우', '은/는')).toBe('은우는');
    expect(josa('번개 FC', '이/가')).toBe('번개 FC가');
    expect(josa('하늘', '으로/로')).toBe('하늘로');
    expect(josa('강', '으로/로')).toBe('강으로');
  });
});

describe('골 상황 판단', () => {
  it('선제골/동점골/역전골/추가골/만회골', () => {
    expect(goalSituation({ mine: 0, theirs: 0 })).toBe('opener');
    expect(goalSituation({ mine: 0, theirs: 1 })).toBe('equalizer');
    expect(goalSituation({ mine: 1, theirs: 1 })).toBe('goAhead');
    expect(goalSituation({ mine: 2, theirs: 1 })).toBe('extend');
    expect(goalSituation({ mine: 0, theirs: 3 })).toBe('consolation');
  });
});

describe('해설 문장', () => {
  it('같은 문장을 연달아 고르지 않는다', () => {
    const c = new Commentator(seededRng(5));
    const lines = [() => 'A', () => 'B', () => 'C', () => 'D'];
    let prev = '';
    for (let i = 0; i < 50; i++) {
      const now = c.pick('t', lines, {});
      expect(now).not.toBe(prev);
      prev = now;
    }
  });

  it('20경기 동안 빈 값이 문장에 새지 않고, 해설이 충분히 다양하다', async () => {
    const texts = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const e of await playMatch(seed)) {
        expect(e.text).not.toMatch(/undefined|null|NaN|\$\{/);
        texts.add(e.text);
      }
    }
    expect(texts.size).toBeGreaterThan(150);
  });

  it('골 해설에 현재 점수가 들어간다', async () => {
    const events = await playMatch(11);
    const goals = events.filter((e) => e.type === 'goal');
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) expect(g.text).toMatch(/\(\d+:\d+\)/);
  });
});
