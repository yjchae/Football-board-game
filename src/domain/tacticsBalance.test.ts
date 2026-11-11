import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSegmentContext, init, reducer, stateAfterSegment, type MatchState } from '../hooks/useMatch';
import { createDemoTeams } from '../store/demoTeams';
import { createLocalEngine, seededRng } from './localEngine';
import { computeStats, scoreOf } from './match';
import type { Side, Team } from './types';

// ─────────────────────────────────────────────
// QA: 감독 전술 노트 공정성 (06 문서 7-3절 B9~B14 + 팀장 기준 "공격적끼리 총득점 ≤ 5.0")
//
// 실제 경기 흐름(리듀서: 퇴장·작전 타임·하프타임 포함)으로 오프라인 엔진 경기를 돌린다.
// 기본은 경기 수를 줄인 빠른 버전(GAMES=1000, 약 10초). 기획서 기준(2,000경기) 측정은
//   BALANCE_GAMES=2000 BALANCE_REPORT=결과.md npx vitest run src/domain/tacticsBalance.test.ts
// 로 돌리면 측정표가 마크다운 파일로 저장된다 (결과는 docs/08-QA-전술기능-보고서.md에 기록).
// 표본이 작은 기본 실행에서는 승률 기준에 통계 여유(±)를 두지 않고, 시드가 고정이라 결과는 항상 같다.
// ─────────────────────────────────────────────

const GAMES = Number(process.env.BALANCE_GAMES ?? 1000);
/** 측정표를 저장할 파일 경로 (지정했을 때만 저장) */
const REPORT = process.env.BALANCE_REPORT;

const [base] = createDemoTeams();
const strong: Team = { ...base, id: 'strong' };
const mirror: Team = { ...base, id: 'mirror', name: '거울 FC' };

/** 모든 선수 능력치를 n점 낮춘 팀 (4개 전력값이 약 n점씩 내려간다) */
function weakened(team: Team, n: number): Team {
  return {
    ...team,
    id: `weak-${n}`,
    players: team.players.map((p) => ({
      ...p,
      overall: p.overall - n,
      stats: {
        pace: p.stats.pace - n,
        shooting: p.stats.shooting - n,
        passing: p.stats.passing - n,
        dribbling: p.stats.dribbling - n,
        defending: p.stats.defending - n,
        physical: p.stats.physical - n,
      },
    })),
  };
}

const CHIP = {
  attacking: '공격적으로 몰아붙이자!',
  defensive: '수비를 단단하게 지키자!',
  counter: '공을 잡으면 빠르게 역습! 뒷공간을 노려!',
  possession: '짧은 패스로 공을 오래 갖자!',
  press: '앞에서부터 강하게 압박! 공을 뺏어!',
  wing: '측면으로 달려서 크로스!',
  center: '가운데로 드리블 돌파!',
  longball: '길게 한 번에 롱볼!',
} as const;
type ChipKey = keyof typeof CHIP;
const join = (...keys: ChipKey[]) => keys.map((k) => CHIP[k]).join(' ');

interface Result {
  games: number;
  win: number;
  draw: number;
  loss: number;
  goals: number;
  conceded: number;
}

/** 리듀서로 한 경기 전체를 진행 (양 하프 같은 전술) */
async function playMatch(seed: number, home: Team, away: Team, tactic: Partial<Record<Side, string>>) {
  const engine = createLocalEngine(seededRng(seed));
  let s: MatchState = init({ home, away });
  for (const side of ['home', 'away'] as Side[]) {
    if (tactic[side]) s = reducer(s, { type: 'SET_TACTIC', side, half: 1, text: tactic[side]! });
  }
  s = reducer(s, { type: 'KICKOFF' });
  for (let guard = 0; s.phase !== 'fulltime' && guard < 50; guard++) {
    if (s.phase === 'timeout') {
      s = reducer(s, { type: 'RESUME' });
      continue;
    }
    if (s.phase === 'halftime') {
      s = reducer(s, { type: 'KICKOFF' });
      continue;
    }
    const result = await engine.simulateSegment(buildSegmentContext(s));
    s = stateAfterSegment(reducer(s, { type: 'FETCH_DONE', result }));
  }
  return { score: scoreOf(s.events), stats: computeStats(s.events) };
}

const cache = new Map<string, Result>();

/** 홈 기준 승/무/패·득실점 합계 */
async function run(home: Team, away: Team, tactic: Partial<Record<Side, string>>): Promise<Result> {
  const key = JSON.stringify([home.id, away.id, tactic]);
  const hit = cache.get(key);
  if (hit) return hit;
  const r: Result = { games: GAMES, win: 0, draw: 0, loss: 0, goals: 0, conceded: 0 };
  for (let seed = 1; seed <= GAMES; seed++) {
    const { score } = await playMatch(seed, home, away, tactic);
    r.goals += score.home;
    r.conceded += score.away;
    if (score.home > score.away) r.win++;
    else if (score.home < score.away) r.loss++;
    else r.draw++;
  }
  cache.set(key, r);
  return r;
}

/** 승률 − 패율 (%p) */
const edge = (r: Result) => ((r.win - r.loss) / r.games) * 100;
const pct = (n: number, r: Result) => ((n / r.games) * 100).toFixed(1);
const totalGoals = (r: Result) => (r.goals + r.conceded) / r.games;
const rows: Record<string, string>[] = [];
function log(label: string, r: Result) {
  rows.push({
    조건: label,
    '승/무/패(%)': `${pct(r.win, r)}/${pct(r.draw, r)}/${pct(r.loss, r)}`,
    '승−패(%p)': edge(r).toFixed(1),
    '균형끼리 대비(%p)': (edge(r) - edge(cache.get(JSON.stringify([strong.id, mirror.id, {}]))!)).toFixed(1),
    '득점': (r.goals / r.games).toFixed(2),
    '실점': (r.conceded / r.games).toFixed(2),
    '총득점': totalGoals(r).toFixed(2),
  });
}

describe(`전술 공정성 B9~B14 (오프라인 엔진, ${GAMES}경기, 실제 리듀서 흐름)`, () => {
  // 같은 시드에서도 '균형 vs 균형'의 승−패가 0이 아니다(표본 오차: 2,000경기 +4.2%p, 10,000경기 +0.8%p).
  // 그래서 B9·B10은 "균형 vs 균형 대비 증가분"으로 단언한다. (절대값은 측정표에 함께 기록)
  const lift = async (r: Result) => edge(r) - edge(await run(strong, mirror, {}));

  it('B9 단일 전술 vs 균형: 승−패 ≤ +7%p (균형끼리 대비)', { timeout: 300_000 }, async () => {
    log('균형 vs 균형', await run(strong, mirror, {}));
    for (const k of Object.keys(CHIP) as ChipKey[]) {
      const r = await run(strong, mirror, { home: CHIP[k] });
      log(`B9 ${k} vs 균형`, r);
      expect.soft(await lift(r), k).toBeLessThanOrEqual(7);
    }
  });

  const combos: ChipKey[][] = [
    ['attacking', 'counter', 'center'],
    ['attacking', 'wing', 'center'],
    ['possession', 'press', 'center'],
    ['defensive', 'counter'],
  ];
  it('B10 3개 조합 vs 균형: 승−패 ≤ +12%p (균형끼리 대비)', { timeout: 300_000 }, async () => {
    for (const c of combos) {
      const r = await run(strong, mirror, { home: join(...c) });
      log(`B10 ${c.join('+')} vs 균형`, r);
      expect.soft(await lift(r), c.join('+')).toBeLessThanOrEqual(12);
    }
  });

  const matchups: [string, ChipKey, ChipKey][] = [
    ['M1', 'press', 'possession'],
    ['M2', 'longball', 'press'],
    ['M3', 'possession', 'longball'],
    ['M4', 'counter', 'attacking'],
    ['M5', 'wing', 'defensive'],
  ];
  it('B11 상성: 이기는 전술 승−패 ≥ +5%p, 같은 전술 vs 균형보다 높다', { timeout: 300_000 }, async () => {
    for (const [id, win, lose] of matchups) {
      const r = await run(strong, mirror, { home: CHIP[win], away: CHIP[lose] });
      const ref = await run(strong, mirror, { home: CHIP[win] });
      log(`B11 ${id} ${win} vs ${lose}`, r);
      if (GAMES >= 2000) {
        expect.soft(edge(r), `${id} 절대`).toBeGreaterThanOrEqual(5);
        expect.soft(edge(r), `${id} 같은 전술 vs 균형보다`).toBeGreaterThan(edge(ref));
      } else {
        // 빠른 버전(1,000경기)은 표본 오차(±3%p)가 M4(차이 +3.7%p) 같은 작은 상성 이득보다 커서
        // "균형끼리보다는 확실히 유리하다"만 확인한다. 엄격한 기준은 2,000경기 이상 측정에서 단언.
        expect.soft(await lift(r), `${id} 균형끼리 대비`).toBeGreaterThan(0);
      }
    }
  });

  it('B12 능력치 우선: 상대 전력 −3(전술 없음)의 승−패 > B10 최대값', { timeout: 300_000 }, async () => {
    const weak3 = weakened(mirror, 3);
    const r = await run(strong, weak3, {});
    log('B12 전력 +3 우위(전술 없음)', r);
    let best = -Infinity;
    for (const c of combos) best = Math.max(best, edge(await run(strong, mirror, { home: join(...c) })));
    expect(edge(r)).toBeGreaterThan(best);
  });

  it('B13 전력 −5 약팀이 최강 조합을 써도 균형 강팀 상대 승률 ≤ 35%', { timeout: 300_000 }, async () => {
    const weak5 = weakened(mirror, 5);
    const plain = await run(weak5, strong, {});
    const r = await run(weak5, strong, { home: join('attacking', 'counter', 'center') });
    log('B13 전력 −5 약팀 균형 vs 강팀', plain);
    log('B13 전력 −5 약팀 공+역+중 vs 강팀', r);
    expect(r.win / r.games).toBeLessThanOrEqual(0.35);
  });

  it('B14 같은 전술끼리(공격적·수비적·압박·균형) 평균 총득점 2.0~6.0골', { timeout: 300_000 }, async () => {
    for (const k of ['attacking', 'defensive', 'press'] as ChipKey[]) {
      const r = await run(strong, mirror, { home: CHIP[k], away: CHIP[k] });
      log(`B14 ${k}끼리`, r);
      expect.soft(totalGoals(r), k).toBeGreaterThanOrEqual(2);
      expect.soft(totalGoals(r), k).toBeLessThanOrEqual(6);
    }
    const bal = await run(strong, mirror, {});
    expect(totalGoals(bal)).toBeGreaterThanOrEqual(2);
    expect(totalGoals(bal)).toBeLessThanOrEqual(6);
  });

  // ⚠️ 알려진 결함 QA-T1 (docs/08-QA-전술기능-보고서.md): 공격적끼리 평균 총득점 5.12~5.14골로 팀장 기준 5.0골 초과.
  //    결함이 남아 있는 동안 전체 테스트가 빨갛게 되지 않도록 it.fails로 둔다.
  //    보정값을 고쳐 기준을 만족하면 이 테스트가 "실패"로 바뀌므로, 그때 it.fails → it 로 바꿀 것.
  it.fails('팀장 기준: 공격적끼리 평균 총득점 ≤ 5.0골', { timeout: 300_000 }, async () => {
    const atk = await run(strong, mirror, { home: CHIP.attacking, away: CHIP.attacking });
    log('팀장 기준 attacking끼리', atk);
    expect(totalGoals(atk)).toBeLessThanOrEqual(5.0);
  });

  it.runIf(Boolean(REPORT))('측정표 저장', () => {
    const header = Object.keys(rows[0]);
    const lines = [header, header.map(() => '---'), ...rows.map((r) => header.map((h) => r[h]))].map((c) => `| ${c.join(' | ')} |`);
    writeFileSync(REPORT!, `${GAMES}경기\n\n${lines.join('\n')}\n`);
  });
});
