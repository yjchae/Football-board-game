import {
  eventId,
  scoreOf,
  teamPower,
  type MatchEngine,
  type SegmentContext,
  type SegmentResult,
  type SideContext,
} from './match';
import {
  AMBIENCE,
  BUILD_UP,
  chooseGoalStyle,
  Commentator,
  CORNER,
  FOUL,
  goalSituation,
  goalText,
  INJURY,
  MISS,
  OFFSIDE,
  RED,
  SAVE,
  SHOT_ON_TARGET,
  summaryText,
  summaryTitle,
  YELLOW,
  type SummaryVars,
} from './commentary';
import type { MatchEvent, Player, Role, Side } from './types';

// ─────────────────────────────────────────────
// 오프라인 엔진: AI 키가 없거나 AI 호출이 실패했을 때 쓰는
// 능력치 기반 확률 시뮬레이터. (테스트를 위해 난수 함수 주입 가능)
//   1단계 planSegment: 능력치로 '무슨 일이' 일어날지 정한다
//   2단계 narrate:     시간 순서대로 점수 상황을 따라가며 해설을 붙인다
// ─────────────────────────────────────────────

type Rng = () => number;

/** 시드 고정 난수 (테스트 재현용) */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pickOne = <T,>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

function pickPlayer(ctx: SideContext, roles: Role[], rng: Rng, excludeId?: string): Player | undefined {
  const field = ctx.onPitch.filter((fp) => fp.player.id !== excludeId);
  const pool = field.filter((fp) => roles.includes(fp.slotRole)).map((fp) => fp.player);
  const fallback = field.filter((fp) => fp.slotRole !== 'GK').map((fp) => fp.player);
  const list = pool.length ? pool : fallback;
  return list.length ? pickOne(list, rng) : undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 1단계에서 정하는 "무슨 일이 일어났는지" (아직 문장 없음)
type Plan =
  | { kind: 'goal'; minute: number; side: Side; shooter: Player; assist?: Player; keeper?: Player }
  | { kind: 'saved'; minute: number; side: Side; shooter: Player; keeper: Player; defender: Player }
  | { kind: 'miss'; minute: number; side: Side; shooter: Player; defender: Player; midfielder: Player }
  | { kind: 'card'; minute: number; side: Side; type: 'foul' | 'yellow' | 'red'; player: Player }
  | { kind: 'injury' | 'corner' | 'offside' | 'mood'; minute: number; side: Side; player: Player };

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

export function createLocalEngine(rng: Rng = Math.random): MatchEngine {
  // 경기 하나 동안 같은 해설자가 문장 반복을 기억한다
  const voice = new Commentator(rng);

  return {
    label: '오프라인 엔진',
    async simulateSegment(ctx: SegmentContext): Promise<SegmentResult> {
      const plans = planSegment(ctx, rng);
      plans.sort((a, b) => a.minute - b.minute);
      const events = narrate(plans, ctx, voice, rng);
      const result: SegmentResult = { events };
      if (ctx.isLastOfHalf) result.summary = localSummary(ctx, events, voice);
      return result;
    },
  };
}

// ─────────────── 1단계: 능력치로 사건 정하기 ───────────────

function planSegment(ctx: SegmentContext, rng: Rng): Plan[] {
  const { start, end } = ctx.segment;
  const minute = () => start + 1 + Math.floor(rng() * (end - start));
  const plans: Plan[] = [];

  for (const side of ['home', 'away'] as Side[]) {
    const me = ctx[side];
    const opp = ctx[other(side)];
    const my = teamPower(me);
    const their = teamPower(opp);
    const keeper = opp.onPitch.find((fp) => fp.slotRole === 'GK')?.player;
    const defender = () => pickPlayer(opp, ['DF'], rng);

    // 중원 싸움이 기회 수를 결정
    const control = clamp(0.5 + (my.midfield - their.midfield) / 120, 0.25, 0.75);
    const chances = Math.round(0.4 + control * 2 + rng() * 1.2);

    for (let i = 0; i < chances; i++) {
      const shooter = pickPlayer(me, ['FW', 'FW', 'MF'], rng);
      if (!shooter) continue;
      const goalChance = clamp(0.12 + (my.attack - (their.defense + their.keeper) / 2) / 200, 0.04, 0.3);
      const roll = rng();
      const m = minute();

      if (roll < goalChance) {
        const assist = pickPlayer(me, ['MF', 'FW'], rng, shooter.id);
        plans.push({ kind: 'goal', minute: m, side, shooter, assist, keeper });
      } else if (roll < goalChance + 0.25 && keeper) {
        plans.push({ kind: 'saved', minute: m, side, shooter, keeper, defender: defender() ?? keeper });
      } else {
        const d = defender() ?? keeper ?? shooter;
        // 패스를 주는 선수는 슈팅한 선수와 다른 사람으로
        const passer = pickPlayer(me, ['MF'], rng, shooter.id) ?? pickPlayer(me, ['DF', 'FW'], rng, shooter.id) ?? shooter;
        plans.push({ kind: 'miss', minute: m, side, shooter, defender: d, midfielder: passer });
      }
    }

    const anyone = () => pickPlayer(me, ['DF', 'MF', 'FW'], rng);
    const p1 = anyone();
    if (p1 && rng() < 0.5) plans.push({ kind: 'corner', minute: minute(), side, player: pickPlayer(me, ['MF'], rng) ?? p1 });
    const fw = pickPlayer(me, ['FW'], rng);
    if (fw && rng() < 0.2) plans.push({ kind: 'offside', minute: minute(), side, player: fw });

    const fouler = pickPlayer(me, ['DF', 'MF'], rng);
    if (fouler && rng() < 0.45) {
      const r = rng();
      plans.push({ kind: 'card', minute: minute(), side, player: fouler, type: r < 0.04 ? 'red' : r < 0.3 ? 'yellow' : 'foul' });
    }
    const hurt = anyone();
    if (hurt && rng() < 0.06) plans.push({ kind: 'injury', minute: minute(), side, player: hurt });
  }

  // 분위기 해설은 구간당 최대 1개
  const moodSide: Side = rng() < 0.5 ? 'home' : 'away';
  const moodPlayer = pickPlayer(ctx[moodSide], ['DF', 'MF', 'FW'], rng);
  if (moodPlayer && rng() < 0.45) plans.push({ kind: 'mood', minute: minute(), side: moodSide, player: moodPlayer });
  return plans;
}

// ─────────────── 2단계: 시간 순서대로 해설 붙이기 ───────────────

function narrate(plans: Plan[], ctx: SegmentContext, voice: Commentator, rng: Rng): MatchEvent[] {
  const score = { ...ctx.score };
  // 이번 경기 득점 기록 (해트트릭 판단용)
  const goalsBy = new Map<string, number>();
  for (const e of ctx.history) if (e.type === 'goal' && e.playerId) goalsBy.set(e.playerId, (goalsBy.get(e.playerId) ?? 0) + 1);

  const events: MatchEvent[] = [];
  const push = (e: Omit<MatchEvent, 'id'>) => events.push({ id: eventId(), ...e });

  for (const p of plans) {
    const team = ctx[p.side].teamName;
    const shotVars = (shooter: Player, keeper: Player, defender: Player) => ({ s: shooter.name, k: keeper.name, d: defender.name, team });

    switch (p.kind) {
      case 'goal': {
        const before = { mine: score[p.side], theirs: score[other(p.side)] };
        score[p.side] += 1;
        const count = (goalsBy.get(p.shooter.id) ?? 0) + 1;
        goalsBy.set(p.shooter.id, count);
        const text = goalText(voice, {
          shooter: p.shooter,
          assist: p.assist,
          keeper: p.keeper,
          team,
          style: chooseGoalStyle(p.shooter, rng),
          situation: goalSituation(before),
          scorerGoals: count,
          minute: p.minute,
          scoreText: `${score.home}:${score.away}`,
        });
        push({ minute: p.minute, type: 'goal', side: p.side, playerId: p.shooter.id, assistId: p.assist?.id, text, highlight: true });
        break;
      }
      case 'saved': {
        const v = shotVars(p.shooter, p.keeper, p.defender);
        push({ minute: p.minute, type: 'shot', side: p.side, playerId: p.shooter.id, text: voice.pick('shot', SHOT_ON_TARGET, v), highlight: false });
        push({ minute: p.minute, type: 'save', side: other(p.side), playerId: p.keeper.id, text: voice.pick('save', SAVE, v), highlight: rng() < 0.4 });
        break;
      }
      case 'miss': {
        const v = { ...shotVars(p.shooter, p.defender, p.defender), m: p.midfielder.name };
        const buildUp = rng() < 0.35;
        push({
          minute: p.minute,
          type: buildUp ? 'chance' : 'shot',
          side: p.side,
          playerId: p.shooter.id,
          text: buildUp ? voice.pick('build', BUILD_UP, v) : voice.pick('miss', MISS, v),
          highlight: false,
        });
        break;
      }
      case 'card': {
        const v = { team, p: p.player.name };
        const lines = p.type === 'red' ? RED : p.type === 'yellow' ? YELLOW : FOUL;
        push({ minute: p.minute, type: p.type, side: p.side, playerId: p.player.id, text: voice.pick(p.type, lines, v), highlight: p.type === 'red' });
        break;
      }
      case 'corner':
      case 'offside':
      case 'injury': {
        const lines = { corner: CORNER, offside: OFFSIDE, injury: INJURY }[p.kind];
        push({ minute: p.minute, type: p.kind, side: p.side, playerId: p.player.id, text: voice.pick(p.kind, lines, { team, p: p.player.name }), highlight: false });
        break;
      }
      case 'mood': {
        const v = { team, other: ctx[other(p.side)].teamName, p: p.player.name };
        push({ minute: p.minute, type: 'info', side: null, text: voice.pick('mood', AMBIENCE, v), highlight: false });
        break;
      }
    }
  }
  return events;
}

// ─────────────── 하프 정리 ───────────────

function localSummary(ctx: SegmentContext, newEvents: MatchEvent[], voice: Commentator) {
  const all = [...ctx.history, ...newEvents];
  const half = ctx.segment.half;
  const halfEvents = all.filter((e) => (half === 1 ? e.minute <= 45 : e.minute > 45));
  const score = scoreOf(all);
  const home = ctx.home.teamName;
  const away = ctx.away.teamName;

  // MVP: 이번 하프 최다 득점자
  const scorerCount = new Map<string, number>();
  for (const g of halfEvents) if (g.type === 'goal' && g.playerId) scorerCount.set(g.playerId, (scorerCount.get(g.playerId) ?? 0) + 1);
  const [mvpPlayerId, mvpGoals = 0] = [...scorerCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  // 가장 많이 막은 골키퍼
  const saveCount = new Map<string, number>();
  for (const e of halfEvents) if (e.type === 'save' && e.playerId) saveCount.set(e.playerId, (saveCount.get(e.playerId) ?? 0) + 1);
  const [keeperId, saves = 0] = [...saveCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  // 경기장·벤치 선수에서 이름 찾기 (이미 교체되어 나간 선수는 이름 생략)
  const everyone = [ctx.home, ctx.away].flatMap((t) => [...t.onPitch.map((f) => f.player), ...t.bench]);
  const nameOf = (id?: string) => everyone.find((p) => p.id === id)?.name;

  const vars: SummaryVars = {
    half: half === 1 ? '전반전' : '후반전',
    home,
    away,
    hs: score.home,
    as: score.away,
    leader: score.home === score.away ? undefined : score.home > score.away ? home : away,
    trailer: score.home === score.away ? undefined : score.home > score.away ? away : home,
    mvp: nameOf(mvpPlayerId),
    mvpGoals,
    shots: halfEvents.filter((e) => e.type === 'shot' || e.type === 'goal').length,
    saves,
    topKeeper: nameOf(keeperId),
  };
  return { title: summaryTitle(voice, vars), text: summaryText(voice, vars), mvpPlayerId };
}
