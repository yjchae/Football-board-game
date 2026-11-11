import { describe, expect, it } from 'vitest';
import { createDemoTeams } from '../store/demoTeams';
import { createLocalEngine, seededRng } from './localEngine';
import { buildSideContext, computeStats, createMatchSide, SEGMENTS, type SegmentContext } from './match';
import type { MatchEvent, Team } from './types';

// ─────────────────────────────────────────────
// 감독 전술 노트 × 오프라인 엔진 (06 문서 7-1·7-2절)
//   B0: 전술이 없으면 같은 시드에서 예전 엔진과 한 글자도 다르지 않다
//   B1~B8: 전술마다 의도한 방향으로 경기 기록이 움직인다
// ─────────────────────────────────────────────

const [home, away] = createDemoTeams();
// 공정한 비교를 위해 양 팀 모두 '번개 FC' 같은 라인업 (06 문서 7장 공통 조건)
const mirror: Team = { ...home, id: 'mirror' };

async function playMatch(seed: number, teams: { home: Team; away: Team }, tactic: { home?: string; away?: string } = {}) {
  const engine = createLocalEngine(seededRng(seed));
  let history: MatchEvent[] = [];
  const summaries: string[] = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const ctx: SegmentContext = {
      segment: SEGMENTS[i],
      isLastOfHalf: i === 2 || i === 5,
      home: buildSideContext('home', createMatchSide(teams.home), tactic.home),
      away: buildSideContext('away', createMatchSide(teams.away), tactic.away),
      score: { home: 0, away: 0 },
      history,
    };
    const r = await engine.simulateSegment(ctx);
    history = [...history, ...r.events];
    if (r.summary) summaries.push(`S|${r.summary.title}|${r.summary.text}`);
  }
  return { events: history, summaries };
}

/** 32비트 FNV-1a — 이벤트 목록 전체를 짧은 지문으로 */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

/** 30경기의 이벤트(분·종류·팀·선수·문장)를 지문으로 (선수 id는 매번 달라지므로 이름으로) */
async function fingerprint(tactic: { home?: string; away?: string }) {
  const names = new Map([...home.players, ...away.players].map((p) => [p.id, p.name]));
  const lines: string[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const { events, summaries } = await playMatch(seed, { home, away }, tactic);
    lines.push(...summaries);
    for (const e of events) {
      lines.push([seed, e.minute, e.type, e.side, names.get(e.playerId ?? ''), names.get(e.assistId ?? ''), e.text, e.highlight].join('|'));
    }
  }
  return fnv(lines.join('\n'));
}

// 전술 기능을 넣기 전 엔진으로 같은 방식으로 뽑은 지문
const BEFORE_TACTICS = '5292c5f0';

describe('B0 회귀: 전술이 없으면 기존 엔진과 완전히 같다', () => {
  it('빈 전술', async () => {
    expect(await fingerprint({})).toBe(BEFORE_TACTICS);
  });
  it('양 팀 모두 "균형"이라고 적어도 같다', async () => {
    expect(await fingerprint({ home: '평소처럼 균형 있게!', away: '기본대로 하자' })).toBe(BEFORE_TACTICS);
  });
  it('키워드가 없는 글("열심히 하자!")도 같다', async () => {
    expect(await fingerprint({ home: '열심히 하자!', away: '' })).toBe(BEFORE_TACTICS);
  });
});

// ─────────────── 방향성 (균형 vs 균형 대비) ───────────────

const GAMES = 300;

interface Totals {
  shots: number; // 슈팅(골 포함)
  goals: number;
  conceded: number;
  oppShots: number;
  fouls: number; // 파울 + 경고 + 퇴장
  yellows: number;
  corners: number;
  offsides: number;
}

const cache = new Map<string, Totals>();

/** 홈 팀에 전술을 주고 GAMES 경기의 홈 기준 합계 */
async function homeTotals(tactic: string): Promise<Totals> {
  const hit = cache.get(tactic);
  if (hit) return hit;
  const t: Totals = { shots: 0, goals: 0, conceded: 0, oppShots: 0, fouls: 0, yellows: 0, corners: 0, offsides: 0 };
  for (let seed = 1; seed <= GAMES; seed++) {
    const { events } = await playMatch(seed, { home, away: mirror }, { home: tactic });
    const s = computeStats(events);
    t.shots += s.home.shots;
    t.goals += s.home.goals;
    t.conceded += s.away.goals;
    t.oppShots += s.away.shots;
    t.fouls += s.home.fouls + s.home.yellows + s.home.reds;
    t.yellows += s.home.yellows;
    t.corners += s.home.corners;
    t.offsides += events.filter((e) => e.side === 'home' && e.type === 'offside').length;
  }
  cache.set(tactic, t);
  return t;
}

/** 균형 대비 변화율 (+0.12 = 12% 증가) */
async function change(tactic: string, f: (t: Totals) => number) {
  const base = await homeTotals('');
  return f(await homeTotals(tactic)) / f(base) - 1;
}

describe('전술 방향성 (시드 고정, 홈 전술 vs 균형)', () => {
  it('B1 공격적: 슈팅·득점·실점 모두 늘어난다', async () => {
    expect(await change('공격적으로 몰아붙이자!', (t) => t.shots)).toBeGreaterThan(0.1);
    expect(await change('공격적으로 몰아붙이자!', (t) => t.goals)).toBeGreaterThan(0.05);
    expect(await change('공격적으로 몰아붙이자!', (t) => t.oppShots)).toBeGreaterThan(0.02);
  });
  it('B2 수비적: 슈팅·실점·상대 슈팅이 줄어든다', async () => {
    expect(await change('수비를 단단하게 지키자!', (t) => t.shots)).toBeLessThan(-0.08);
    expect(await change('수비를 단단하게 지키자!', (t) => t.conceded)).toBeLessThan(-0.08);
    expect(await change('수비를 단단하게 지키자!', (t) => t.oppShots)).toBeLessThan(-0.06);
  });
  it('B3 역습: 슈팅은 줄고 슈팅당 득점은 오른다', async () => {
    const tactic = '공을 잡으면 빠르게 역습! 뒷공간을 노려!';
    expect(await change(tactic, (t) => t.shots)).toBeLessThan(-0.05);
    expect(await change(tactic, (t) => t.goals / t.shots)).toBeGreaterThan(0.05);
  });
  it('B5 압박: 파울과 경고가 늘어난다', async () => {
    expect(await change('앞에서부터 강하게 압박! 공을 뺏어!', (t) => t.fouls)).toBeGreaterThan(0.15);
    expect(await change('앞에서부터 강하게 압박! 공을 뺏어!', (t) => t.yellows)).toBeGreaterThan(0.2);
  });
  it('B6 측면: 코너킥이 늘어난다', async () => {
    expect(await change('측면으로 달려서 크로스!', (t) => t.corners)).toBeGreaterThan(0.3);
  });
  it('B8 롱볼: 오프사이드가 늘어난다', async () => {
    expect(await change('길게 한 번에 롱볼!', (t) => t.offsides)).toBeGreaterThan(0.35);
  });
  it('전술 해설: 전술이 있는 팀은 해설에 작전이 드러난다', async () => {
    const { events } = await playMatch(3, { home, away: mirror }, { home: '측면으로 달려서 크로스!' });
    const lines = events.filter((e) => /작전대로 측면|측면을 따라 달려/.test(e.text));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(4); // 팀·하프당 최대 2번
  });
});
