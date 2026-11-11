import {
  eventId,
  scoreOf,
  teamPower,
  type MatchEngine,
  type SegmentContext,
  type SegmentResult,
  type SideContext,
} from './match';
import type { MatchEvent, Player, Role, Side } from './types';
import { josa } from '../utils/josa';

// ─────────────────────────────────────────────
// 오프라인 엔진: AI 키가 없거나 AI 호출이 실패했을 때 쓰는
// 능력치 기반 확률 시뮬레이터. (테스트를 위해 난수 함수 주입 가능)
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

function pickPlayer(ctx: SideContext, roles: Role[], rng: Rng): Player | undefined {
  const pool = ctx.onPitch.filter((fp) => roles.includes(fp.slotRole)).map((fp) => fp.player);
  const fallback = ctx.onPitch.filter((fp) => fp.slotRole !== 'GK').map((fp) => fp.player);
  const list = pool.length ? pool : fallback;
  return list.length ? pickOne(list, rng) : undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createLocalEngine(rng: Rng = Math.random): MatchEngine {
  return {
    label: '오프라인 엔진',
    async simulateSegment(ctx: SegmentContext): Promise<SegmentResult> {
      const { start, end } = ctx.segment;
      const events: MatchEvent[] = [];
      const minute = () => start + 1 + Math.floor(rng() * (end - start));

      const sides: Side[] = ['home', 'away'];
      for (const side of sides) {
        const me = ctx[side];
        const opp = ctx[side === 'home' ? 'away' : 'home'];
        const my = teamPower(me);
        const their = teamPower(opp);

        // 중원 싸움이 기회 수를 결정
        const control = clamp(0.5 + (my.midfield - their.midfield) / 120, 0.25, 0.75);
        const chances = Math.round(0.4 + control * 2 + rng() * 1.2);

        for (let i = 0; i < chances; i++) {
          const shooter = pickPlayer(me, ['FW', 'FW', 'MF'], rng);
          const keeper = opp.onPitch.find((fp) => fp.slotRole === 'GK')?.player;
          if (!shooter) continue;

          const goalChance = clamp(0.12 + (my.attack - (their.defense + their.keeper) / 2) / 200, 0.04, 0.3);
          const roll = rng();
          if (roll < goalChance) {
            const assist = pickPlayer(me, ['MF', 'FW'], rng);
            const assistId = assist && assist.id !== shooter.id ? assist.id : undefined;
            events.push({
              id: eventId(),
              minute: minute(),
              type: 'goal',
              side,
              playerId: shooter.id,
              assistId,
              text: pickOne(
                [
                  `골!! ${shooter.name}의 강력한 슈팅이 골망을 흔듭니다!`,
                  `${shooter.name}, 침착하게 골키퍼를 제치고 골!`,
                  `${shooter.name}의 환상적인 마무리! ${josa(me.teamName, '이/가')} 득점합니다!`,
                ],
                rng,
              ),
              highlight: true,
            });
          } else if (roll < goalChance + 0.25 && keeper) {
            const m = minute();
            events.push({
              id: eventId(),
              minute: m,
              type: 'shot',
              side,
              playerId: shooter.id,
              text: `${shooter.name}의 날카로운 슈팅!`,
              highlight: false,
            });
            events.push({
              id: eventId(),
              minute: m,
              type: 'save',
              side: side === 'home' ? 'away' : 'home',
              playerId: keeper.id,
              text: `하지만 ${josa(keeper.name, '이/가')} 몸을 날려 막아냅니다!`,
              highlight: rng() < 0.4,
            });
          } else {
            events.push({
              id: eventId(),
              minute: minute(),
              type: rng() < 0.5 ? 'shot' : 'chance',
              side,
              playerId: shooter.id,
              text: pickOne(
                [`${shooter.name}의 슈팅이 아깝게 빗나갑니다!`, `${shooter.name}, 골대를 살짝 넘기네요.`],
                rng,
              ),
              highlight: false,
            });
          }
        }

        // 기타 이벤트: 코너킥, 파울, 카드, 부상
        if (rng() < 0.5) {
          events.push({ id: eventId(), minute: minute(), type: 'corner', side, text: `${me.teamName}의 코너킥 기회!`, highlight: false });
        }
        const fouler = pickPlayer(me, ['DF', 'MF'], rng);
        if (fouler && rng() < 0.45) {
          const r = rng();
          const type = r < 0.04 ? 'red' : r < 0.3 ? 'yellow' : 'foul';
          const text =
            type === 'red'
              ? `퇴장! ${josa(fouler.name, '이/가')} 레드카드를 받았어요!`
              : type === 'yellow'
                ? `${fouler.name}에게 옐로카드! 조심해야 해요.`
                : `${fouler.name}의 파울로 경기가 잠시 멈춥니다.`;
          events.push({ id: eventId(), minute: minute(), type, side, playerId: fouler.id, text, highlight: type === 'red' });
        }
        const hurt = pickPlayer(me, ['DF', 'MF', 'FW'], rng);
        if (hurt && rng() < 0.06) {
          events.push({
            id: eventId(),
            minute: minute(),
            type: 'injury',
            side,
            playerId: hurt.id,
            text: `${josa(hurt.name, '이/가')} 다리를 붙잡고 쓰러졌어요. 교체가 필요할 수도 있어요!`,
            highlight: false,
          });
        }
      }

      events.sort((a, b) => a.minute - b.minute);
      const result: SegmentResult = { events };
      if (ctx.isLastOfHalf) result.summary = localSummary(ctx, events);
      return result;
    },
  };
}

function localSummary(ctx: SegmentContext, newEvents: MatchEvent[]) {
  const all = [...ctx.history, ...newEvents];
  const score = scoreOf(all);
  const half = ctx.segment.half;
  const label = half === 1 ? '전반전' : '후반전';
  const leader =
    score.home === score.away ? null : score.home > score.away ? ctx.home.teamName : ctx.away.teamName;

  const goals = all.filter((e) => e.type === 'goal');
  const scorerCount = new Map<string, number>();
  for (const g of goals) if (g.playerId) scorerCount.set(g.playerId, (scorerCount.get(g.playerId) ?? 0) + 1);
  const mvpPlayerId = [...scorerCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const title = leader ? `${leader}, ${label}을 앞서며 마무리!` : `${label}, 팽팽한 균형!`;
  const text = leader
    ? `${label}이 끝났어요. ${ctx.home.teamName} ${score.home} : ${score.away} ${ctx.away.teamName}. ${josa(leader, '이/가')} 리드하고 있어요!`
    : `${label}이 끝났어요. ${score.home} : ${score.away}, 두 팀 모두 한 치의 양보도 없었어요.`;
  return { title, text, mvpPlayerId };
}
