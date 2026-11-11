import { josa as j } from '../utils/josa';
import type { TacticKey } from './tactics';
import type { Player } from './types';

// ─────────────────────────────────────────────
// 오프라인 엔진 해설 문장 모음
//
// - 상황별로 문장 틀을 여러 개 준비하고, 같은 경기에서
//   최근에 쓴 문장은 피해서 고른다 (Commentator.pick).
// - 골 장면은 "득점 방식(선수 능력치)" + "경기 상황(동점·역전 등)"을
//   조합해서 만든다.
// ─────────────────────────────────────────────

type Rng = () => number;
type Line<V> = (v: V) => string;

/** 같은 문장이 연달아 나오지 않게 기억하면서 고르는 해설자 */
export class Commentator {
  private recent = new Map<string, number[]>();

  constructor(private rng: Rng) {}

  pick<V>(category: string, lines: Line<V>[], v: V): string {
    const used = this.recent.get(category) ?? [];
    const fresh = lines.map((_, i) => i).filter((i) => !used.includes(i));
    const pool = fresh.length ? fresh : lines.map((_, i) => i);
    const index = pool[Math.floor(this.rng() * pool.length)];

    // 문장 수의 절반까지는 다시 쓰지 않는다
    const memory = Math.max(1, Math.floor(lines.length / 2));
    this.recent.set(category, [...used, index].slice(-memory));
    return lines[index](v);
  }

  chance(p: number): boolean {
    return this.rng() < p;
  }
}

// ─────────────── 골: 득점 방식 ───────────────

export type GoalStyle = 'longshot' | 'solo' | 'counter' | 'header' | 'finesse' | 'tapin';

/** 선수 능력치로 그럴듯한 득점 방식을 고른다 */
export function chooseGoalStyle(shooter: Player, rng: Rng): GoalStyle {
  const s = shooter.stats;
  const weights: [GoalStyle, number][] = [
    ['longshot', s.shooting * 1.2],
    ['solo', s.dribbling],
    ['counter', s.pace],
    ['header', s.physical * 0.9],
    ['finesse', (s.shooting + s.dribbling) / 2],
    ['tapin', 60],
  ];
  // 능력치가 높을수록 그 방식이 나올 확률이 커진다 (제곱으로 차이를 키움)
  const total = weights.reduce((a, [, w]) => a + w * w, 0);
  let r = rng() * total;
  for (const [style, w] of weights) {
    r -= w * w;
    if (r <= 0) return style;
  }
  return 'tapin';
}

interface GoalVars {
  s: string; // 득점자
  a?: string; // 도움
  k?: string; // 상대 골키퍼
  team: string;
}

const GOAL_LINES: Record<GoalStyle, Line<GoalVars>[]> = {
  longshot: [
    (v) => `${j(v.s, '이/가')} 먼 거리에서 그대로 때립니다! 대포알 중거리 슛이 골망 구석에 꽂혀요!`,
    (v) => `페널티 박스 밖에서 ${v.s}의 캐논 슈팅! 골키퍼가 손도 못 대요!`,
    (v) => `${v.s}, 아무도 예상 못 한 30미터 장거리 슛! 공이 쭉 날아가 골!`,
    (v) => `튀어나온 공을 ${j(v.s, '이/가')} 논스톱 발리로! 이건 정말 그림 같은 골이에요!`,
  ],
  solo: [
    (v) => `${v.s}의 드리블 쇼! 수비수 두 명을 제치고 마무리까지 완벽해요!`,
    (v) => `${j(v.s, '이/가')} 공을 몰고 혼자서 끝까지! 개인기로 만든 멋진 골!`,
    (v) => `발바닥 터치, 헛다리 짚기! ${j(v.s, '이/가')} 수비를 흔들고 골을 넣습니다!`,
    (v) => `${v.s}, 골키퍼까지 가볍게 제치고 빈 골대에 쏙!`,
  ],
  counter: [
    (v) => `번개 같은 역습! ${j(v.s, '이/가')} 단숨에 달려가 골키퍼와 1대1, 골!`,
    (v) => `${v.s}의 폭풍 질주! 아무도 따라잡지 못하고 그대로 골!`,
    (v) => `수비 뒷공간을 파고든 ${v.s}! 빠른 발로 만든 골이에요!`,
    (v) => `우리 진영에서 시작된 역습이 ${v.s}의 발끝에서 골로 끝납니다!`,
  ],
  header: [
    (v) => `높이 뜬 크로스! ${j(v.s, '이/가')} 솟구쳐 오르며 헤더 골!`,
    (v) => `코너킥 상황에서 ${v.s}의 강력한 헤딩! 골대 안으로 꽂힙니다!`,
    (v) => `${v.s}, 수비수보다 한 뼘 더 높이 뛰어 머리로 골을 만들어요!`,
    (v) => `날아오는 공을 ${j(v.s, '이/가')} 다이빙 헤더로! 정말 용감한 골이에요!`,
  ],
  finesse: [
    (v) => `${v.s}의 감아차기! 공이 휘어지며 골대 구석으로 빨려 들어가요!`,
    (v) => `골키퍼 키를 넘기는 ${v.s}의 칩슛! 살짝 띄운 공이 그대로 골!`,
    (v) => `${j(v.s, '이/가')} 침착하게 반대쪽 구석으로 밀어 넣습니다! 깔끔한 마무리!`,
    (v) => `${v.s}의 프리킥! 수비벽을 넘어 골대 안으로 휘어 들어갑니다!`,
  ],
  tapin: [
    (v) => `골문 앞 혼전! ${j(v.s, '이/가')} 가장 먼저 반응해 밀어 넣어요!`,
    (v) => `골키퍼가 쳐낸 공을 ${j(v.s, '이/가')} 놓치지 않고 골!`,
    (v) => `${v.s}, 빈 골대에 가볍게 톡! 자리를 잘 잡고 있었어요!`,
    (v) => `${v.s}의 집중력! 끝까지 공을 쫓아가 골로 만듭니다!`,
  ],
};

const ASSIST_LINES: Line<GoalVars>[] = [
  (v) => `${v.a}의 킬패스가 빛났어요!`,
  (v) => `${v.a}의 크로스가 정확했어요!`,
  (v) => `${j(v.a ?? '', '과/와')} ${v.s}의 환상 호흡!`,
  (v) => `도움은 ${v.a}! 눈이 좋은 패스였어요.`,
  (v) => `${v.a}의 한 번에 넘겨준 롱패스가 시작이었어요!`,
  (v) => `${j(v.a ?? '', '이/가')} 수비 사이로 찔러준 패스, 완벽했어요!`,
];

// ─────────────── 골: 경기 상황 ───────────────

export type GoalSituation =
  | 'opener' // 경기 첫 골
  | 'equalizer' // 동점골
  | 'goAhead' // 동점에서 앞서가는 골
  | 'comeback' // 지고 있다가 역전
  | 'extend' // 점수 차 벌리기
  | 'consolation' // 지는 팀이 한 골 따라감
  | 'none';

export function goalSituation(before: { mine: number; theirs: number }): GoalSituation {
  const { mine, theirs } = before;
  const after = mine + 1;
  if (mine === 0 && theirs === 0) return 'opener';
  if (after === theirs) return 'equalizer';
  if (mine === theirs) return 'goAhead';
  if (mine < theirs && after > theirs) return 'comeback';
  if (mine > theirs) return 'extend';
  if (after < theirs) return 'consolation';
  return 'none';
}

const SITUATION_LINES: Record<GoalSituation, Line<GoalVars & { score: string }>[]> = {
  opener: [
    (v) => `오늘 경기의 첫 골! ${j(v.team, '이/가')} 먼저 웃습니다. (${v.score})`,
    (v) => `0의 균형이 깨졌어요! ${v.team} 선제골! (${v.score})`,
    (v) => `기다리던 첫 골의 주인공은 ${v.s}! (${v.score})`,
  ],
  equalizer: [
    (v) => `동점골!! 경기가 다시 원점으로 돌아갑니다! (${v.score})`,
    (v) => `${j(v.team, '이/가')} 끝까지 포기하지 않았어요! 따라붙는 동점골! (${v.score})`,
    (v) => `균형을 맞추는 귀중한 한 방! 이제 승부는 다시 시작이에요! (${v.score})`,
  ],
  goAhead: [
    (v) => `${j(v.team, '이/가')} 다시 앞서 나갑니다! (${v.score})`,
    (v) => `팽팽하던 승부를 깨는 골! ${v.team} 리드! (${v.score})`,
    (v) => `중요한 순간에 터진 골! ${j(v.team, '이/가')} 한 발 앞서요! (${v.score})`,
  ],
  comeback: [
    (v) => `역전!!! ${j(v.team, '이/가')} 경기를 뒤집었어요! (${v.score})`,
    (v) => `믿을 수 없는 역전골! 관중석이 들썩들썩! (${v.score})`,
    (v) => `지고 있던 ${j(v.team, '이/가')} 마침내 앞서갑니다! 대역전 드라마! (${v.score})`,
  ],
  extend: [
    (v) => `점수 차를 벌리는 추가골! ${j(v.team, '이/가')} 신났어요! (${v.score})`,
    (v) => `${v.team}, 멈추지 않는 골 행진! (${v.score})`,
    (v) => `쐐기를 박는 골일까요? ${v.team} 달아납니다! (${v.score})`,
  ],
  consolation: [
    (v) => `${j(v.team, '이/가')} 한 골 따라갑니다! 아직 포기하긴 일러요! (${v.score})`,
    (v) => `추격의 불씨를 살리는 골! ${v.team} 힘내라! (${v.score})`,
    (v) => `만회골! ${j(v.team, '이/가')} 다시 힘을 냅니다! (${v.score})`,
  ],
  none: [(v) => `(${v.score})`],
};

const MULTI_GOAL_LINES: Record<2 | 3, Line<GoalVars>[]> = {
  2: [
    (v) => `${v.s}의 오늘 두 번째 골! 멀티골이에요!`,
    (v) => `${v.s}, 벌써 두 골째! 오늘 컨디션 최고예요!`,
  ],
  3: [
    (v) => `해트트릭!!! ${j(v.s, '이/가')} 혼자서 세 골을 넣었어요! 🎩`,
    (v) => `${v.s}의 해트트릭 완성! 오늘의 주인공은 바로 ${v.s}!`,
  ],
};

export interface GoalContext {
  shooter: Player;
  assist?: Player;
  keeper?: Player;
  team: string;
  style: GoalStyle;
  situation: GoalSituation;
  /** 이 골 포함 득점자의 오늘 골 수 */
  scorerGoals: number;
  minute: number;
  scoreText: string;
}

export function goalText(c: Commentator, g: GoalContext): string {
  const v = { s: g.shooter.name, a: g.assist?.name, k: g.keeper?.name, team: g.team, score: g.scoreText };
  const parts: string[] = [];

  // 시간대 감탄사
  if (g.minute <= 5) parts.push(c.pick('goal-early', EARLY_GOAL, v));
  else if (g.minute >= 85) parts.push(c.pick('goal-late', LATE_GOAL, v));
  else parts.push(c.pick('goal-shout', GOAL_SHOUT, v));

  parts.push(c.pick(`goal-${g.style}`, GOAL_LINES[g.style], v));
  if (g.assist && g.style !== 'solo' && c.chance(0.7)) parts.push(c.pick('assist', ASSIST_LINES, v));

  if (g.scorerGoals >= 3) parts.push(c.pick('hattrick', MULTI_GOAL_LINES[3], v));
  else if (g.scorerGoals === 2) parts.push(c.pick('brace', MULTI_GOAL_LINES[2], v));

  parts.push(c.pick(`sit-${g.situation}`, SITUATION_LINES[g.situation], v));
  return parts.filter(Boolean).join(' ');
}

const GOAL_SHOUT: Line<GoalVars>[] = [
  () => '골!!',
  () => '고오오올!',
  () => '들어갔어요!',
  () => '와아아!',
  () => '골인!',
  () => '해냈어요!',
];
const EARLY_GOAL: Line<GoalVars>[] = [
  () => '경기 시작하자마자 골!',
  () => '눈 깜짝할 새 터진 골!',
];
const LATE_GOAL: Line<GoalVars>[] = [
  () => '경기 막판에 터진 골!',
  () => '마지막까지 포기하지 않은 골!',
  () => '종료 직전 극장골!',
];

// ─────────────── 슈팅 / 선방 / 빗나감 ───────────────

interface ShotVars {
  s: string;
  k: string;
  d: string; // 상대 수비수
  team: string;
}

export const SHOT_ON_TARGET: Line<ShotVars>[] = [
  (v) => `${v.s}의 날카로운 슈팅!`,
  (v) => `${j(v.s, '이/가')} 골문 구석을 노리고 강하게 찹니다!`,
  (v) => `${v.s}, 수비 사이로 낮게 깔리는 슈팅!`,
  (v) => `${j(v.s, '이/가')} 가슴 트래핑 후 바로 슈팅!`,
  (v) => `기회를 잡은 ${v.s}, 힘껏 때립니다!`,
  (v) => `${v.s}의 강력한 프리킥이 골문으로 향해요!`,
];

export const SAVE: Line<ShotVars>[] = [
  (v) => `하지만 ${j(v.k, '이/가')} 몸을 날려 막아냅니다!`,
  (v) => `${v.k}의 슈퍼 세이브! 손끝으로 쳐냅니다!`,
  (v) => `${j(v.k, '이/가')} 정면에서 단단하게 잡아냅니다. 안정감 최고!`,
  (v) => `${v.k}, 엄청난 반사신경! 거미손이에요!`,
  (v) => `골대 구석으로 가던 공을 ${j(v.k, '이/가')} 다이빙으로 걷어내요!`,
  (v) => `${j(v.k, '이/가')} 발로 막아냅니다! 팀을 구한 선방!`,
  (v) => `${v.k}의 펀칭! 공이 멀리 튕겨 나가요!`,
  (v) => `1대1 위기! 하지만 ${j(v.k, '이/가')} 각도를 좁혀 막아냅니다!`,
];

export const MISS: Line<ShotVars>[] = [
  (v) => `${v.s}의 슈팅이 아깝게 빗나갑니다!`,
  (v) => `${v.s}, 골대를 살짝 넘기네요. 아쉬워요!`,
  (v) => `땅! ${v.s}의 슈팅이 골대를 맞고 튕겨 나옵니다!`,
  (v) => `${v.s}의 슈팅이 크로스바를 때려요! 정말 아까웠어요!`,
  (v) => `${j(v.d, '이/가')} 몸으로 ${v.s}의 슈팅을 막아냅니다! 투지 넘치는 수비!`,
  (v) => `${v.s}, 너무 힘이 들어갔어요. 공이 관중석으로 날아가요!`,
  (v) => `${v.s}의 슈팅이 골대 옆 그물을 스칩니다. 거의 들어갈 뻔!`,
  (v) => `${j(v.s, '이/가')} 헛발질! 공이 발에 제대로 맞지 않았어요.`,
  (v) => `${v.s}의 감아차기가 골대 밖으로 살짝 휘어 나가요.`,
  (v) => `수비수 ${v.d}의 태클에 ${v.s}의 슈팅이 막힙니다!`,
];

export const BUILD_UP: Line<ShotVars & { m: string }>[] = [
  (v) => `${v.m}의 정확한 패스! ${j(v.s, '이/가')} 공을 받았지만 수비가 빨랐어요.`,
  (v) => `${v.team}의 짧은 패스 연결이 이어집니다. ${v.m} → ${v.s}!`,
  (v) => `${j(v.m, '이/가')} 중원에서 공을 빼앗아 바로 공격으로 전환해요!`,
  (v) => `${v.s}, 측면을 돌파해 크로스! 하지만 ${j(v.d, '이/가')} 걷어냅니다.`,
  (v) => `${v.team}, 원투 패스로 수비를 흔들어요! 기회가 올 것 같아요!`,
  (v) => `${j(v.m, '이/가')} 넓게 벌려주는 롱패스! ${v.team}의 공격이 시작돼요.`,
  (v) => `${v.s}의 침투! 아쉽게 패스가 조금 길었어요.`,
  (v) => `${v.team}의 빠른 템포 공격! 상대 수비가 바빠졌어요.`,
];

// ─────────────── 감독 전술이 드러나는 공격 전개 ───────────────
// 전술이 있는 팀의 BUILD_UP 문장을 대신한다 (팀·하프당 최대 2번, 난수 없이 고른다)

export const TACTIC_LINES: Record<Exclude<TacticKey, 'balanced'>, Line<{ team: string; s: string }>[]> = {
  attacking: [
    (v) => `${v.team}, 수비수까지 올라와서 총공격!`,
    (v) => `${j(v.team, '이/가')} 작전대로 앞으로, 앞으로! 쉬지 않고 몰아붙여요!`,
  ],
  defensive: [
    (v) => `${v.team}, 모두 내려와서 골문을 단단히 지킵니다!`,
    (v) => `${v.team}의 수비벽이 촘촘해요. 작전대로 버티는 중!`,
  ],
  counter: [
    (v) => `${v.team}, 공을 잡자마자 번개 같은 역습!`,
    (v) => `${j(v.s, '이/가')} 뒷공간으로 질주! ${v.team}의 작전이 보여요!`,
  ],
  possession: [
    (v) => `${v.team}, 짧은 패스로 공을 돌리며 기회를 엿봅니다.`,
    (v) => `${v.team}의 패스가 끊기지 않아요. 공을 오래 지키는 작전!`,
  ],
  press: [
    (v) => `${v.team}, 앞에서부터 우르르 달려들어 압박!`,
    (v) => `${v.team}의 강한 압박! 상대가 공을 잡을 틈이 없어요!`,
  ],
  wing: [
    (v) => `${v.s}, 측면을 따라 달려 크로스를 올립니다!`,
    (v) => `${j(v.team, '이/가')} 작전대로 측면을 파고듭니다!`,
  ],
  center: [
    (v) => `${v.s}, 가운데로 드리블 돌파를 시도합니다!`,
    (v) => `${v.team}, 중앙을 정면으로 뚫으려 해요!`,
  ],
  longball: [
    (v) => `${v.team}, 길게 한 번에! 롱볼이 날아갑니다!`,
    (v) => `${j(v.s, '을/를')} 향한 긴 패스! ${v.team}의 롱볼 작전!`,
  ],
};

// ─────────────── 세트피스 / 반칙 / 카드 / 부상 ───────────────

interface TeamVars {
  team: string;
  p: string;
}

export const CORNER: Line<TeamVars>[] = [
  (v) => `${v.team}의 코너킥 기회!`,
  (v) => `${j(v.p, '이/가')} 코너킥을 차러 갑니다. 골문 앞이 북적북적해요!`,
  (v) => `수비수 발에 맞고 나간 공, ${v.team}의 코너킥이에요.`,
  (v) => `${v.team}, 연속 코너킥! 계속 몰아붙여요!`,
  (v) => `${v.p}의 코너킥이 날카롭게 휘어 들어가요!`,
];

export const OFFSIDE: Line<TeamVars>[] = [
  (v) => `${v.p}, 너무 빨리 뛰어나갔어요. 오프사이드!`,
  (v) => `부심의 깃발이 올라갑니다! ${v.p}의 오프사이드예요.`,
  (v) => `${v.team}의 공격, 아쉽게 오프사이드에 걸려요.`,
  (v) => `${j(v.p, '이/가')} 골을 넣었지만… 오프사이드! 노골이에요.`,
];

export const FOUL: Line<TeamVars>[] = [
  (v) => `${v.p}의 파울로 경기가 잠시 멈춥니다.`,
  (v) => `${j(v.p, '이/가')} 상대 유니폼을 잡아당겼어요. 파울!`,
  (v) => `${v.p}의 늦은 태클! 주심이 휘슬을 불어요.`,
  (v) => `${j(v.p, '이/가')} 공 대신 발을 건드렸네요. 프리킥이 선언됩니다.`,
  (v) => `${v.p}의 반칙! 상대 팀에게 좋은 위치의 프리킥이에요.`,
  (v) => `몸싸움 과정에서 ${v.p}의 파울이 나왔어요.`,
];

export const YELLOW: Line<TeamVars>[] = [
  (v) => `${v.p}에게 옐로카드! 조심해야 해요.`,
  (v) => `주심이 노란 카드를 꺼냅니다. ${v.p}, 경고!`,
  (v) => `${v.p}의 거친 태클에 경고가 주어져요. 한 장 더 받으면 퇴장이에요!`,
  (v) => `${j(v.p, '이/가')} 항의하다 옐로카드를 받았어요. 침착해요!`,
];

export const RED: Line<TeamVars>[] = [
  (v) => `퇴장! ${j(v.p, '이/가')} 레드카드를 받았어요! ${j(v.team, '은/는')} 이제 한 명이 부족해요.`,
  (v) => `주심이 빨간 카드를 높이 듭니다! ${v.p} 퇴장!`,
  (v) => `${v.p}의 위험한 태클! 바로 레드카드예요. ${v.team}에게 큰 위기!`,
];

export const INJURY: Line<TeamVars>[] = [
  (v) => `${j(v.p, '이/가')} 다리를 붙잡고 쓰러졌어요. 교체가 필요할 수도 있어요!`,
  (v) => `${v.p}, 충돌 후 일어나지 못하고 있어요. 의료진이 들어갑니다. 🚑`,
  (v) => `${j(v.p, '이/가')} 발목을 불편해해요. 감독님, 교체를 고민해야 할 때예요!`,
  (v) => `${v.p}의 근육에 문제가 생긴 것 같아요. 무리하면 안 돼요!`,
];

// ─────────────── 분위기 ───────────────

export const AMBIENCE: Line<{ team: string; other: string; p: string }>[] = [
  () => `관중석에서 파도타기 응원이 시작됐어요! 🌊`,
  (v) => `${j(v.team, '이/가')} 공을 오래 소유하며 경기를 주도해요.`,
  (v) => `${v.team} 응원단의 북소리가 경기장을 울려요! 🥁`,
  (v) => `${j(v.other, '은/는')} 수비 라인을 내리고 역습을 노리는 작전이에요.`,
  () => `양 팀 모두 숨을 고르는 중이에요. 다음 공격은 누가 먼저 할까요?`,
  (v) => `${v.team} 벤치에서 감독님이 큰 소리로 작전을 지시해요! 📣`,
  (v) => `${j(v.p, '이/가')} 오늘 정말 많이 뛰어다니고 있어요. 체력왕!`,
  (v) => `${j(v.team, '이/가')} 측면을 넓게 쓰면서 상대를 흔들어요.`,
  () => `중원에서 치열한 공 다툼이 이어져요! 누구도 물러서지 않아요.`,
  (v) => `${v.other}, 촘촘한 수비로 ${j(v.team, '을/를')} 꽁꽁 묶고 있어요.`,
  () => `경기장에 함성이 가득해요! 분위기가 점점 뜨거워집니다! 🔥`,
  (v) => `${j(v.p, '이/가')} 동료들에게 손짓하며 집중하자고 외쳐요!`,
];

// ─────────────── 하프 정리 ───────────────

export interface SummaryVars {
  half: '전반전' | '후반전';
  home: string;
  away: string;
  hs: number;
  as: number;
  leader?: string;
  trailer?: string;
  mvp?: string;
  mvpGoals: number;
  shots: number;
  saves: number;
  topKeeper?: string;
}

export function summaryTitle(c: Commentator, v: SummaryVars): string {
  const diff = Math.abs(v.hs - v.as);
  const isFinal = v.half === '후반전';
  const leader = v.leader;
  if (!leader) {
    if (v.hs === 0) return c.pick('t-00', [() => `${v.half}, 골 없는 팽팽한 싸움`, () => `${v.half}, 수비가 빛난 0:0`], v);
    if (isFinal) return c.pick('t-fdraw', [() => `무승부! 치고받은 명승부`, () => `${v.hs}:${v.as}, 누구도 지지 않았어요`], v);
    return c.pick('t-draw', [() => `${v.half}, 치고받는 명승부!`, () => `${v.half}, 승부는 원점!`], v);
  }
  if (diff >= 3)
    return c.pick('t-big', [
      () => `${leader}, ${isFinal ? '압도적인 대승!' : '전반부터 크게 앞서요!'}`,
      () => `${leader}의 골 폭풍!`,
    ], v);
  if (isFinal)
    return c.pick('t-win', diff === 1
      ? [() => `${leader}, 한 골 차 짜릿한 승리!`, () => `손에 땀을 쥔 승부, ${leader} 승리!`]
      : [() => `${leader}, 기분 좋은 승리!`, () => `${j(leader, '이/가')} 경기를 가져갑니다!`, () => `오늘의 승자는 ${leader}!`], v);
  if (diff === 1)
    return c.pick('t-close', [
      () => `${leader}, 한 골 차로 앞서며 마무리!`,
      () => `${v.half}, ${j(leader, '이/가')} 근소하게 앞서요`,
    ], v);
  return c.pick('t-lead', [
    () => `${leader}, ${v.half}을 앞서며 마무리!`,
    () => `${j(leader, '이/가')} 주도한 ${v.half}`,
  ], v);
}

export function summaryText(c: Commentator, v: SummaryVars): string {
  const lines: string[] = [];
  const score = `${v.home} ${v.hs} : ${v.as} ${v.away}`;
  lines.push(
    c.pick('s-open', [
      () => `${v.half}이 끝났어요. ${score}.`,
      () => `${v.half} 종료 휘슬! ${v.half === '후반전' ? '최종' : '현재'} 점수는 ${score}.`,
      () => `숨 가빴던 ${v.half}이 마무리됐어요. ${score}!`,
    ], v),
  );

  if (v.leader && v.trailer) {
    lines.push(
      v.half === '전반전'
        ? c.pick('s-lead1', [
            () => `${j(v.leader!, '이/가')} 리드하고 있어요! ${j(v.trailer!, '은/는')} 후반에 반격할 수 있을까요?`,
            () => `${j(v.trailer!, '은/는')} 하프타임에 작전을 바꿔 볼 필요가 있어요!`,
          ], v)
        : c.pick('s-lead2', [
            () => `${v.leader}의 승리! 모두 정말 잘 싸웠어요.`,
            () => `${j(v.leader!, '이/가')} 끝까지 리드를 지켜냈어요! ${v.trailer}도 박수 받을 만해요.`,
          ], v),
    );
  } else {
    lines.push(
      c.pick('s-even', [
        () => `두 팀 모두 한 치의 양보도 없었어요.`,
        () => (v.half === '전반전' ? `후반전에 승부가 갈릴 것 같아요!` : `무승부! 다음 경기에서 다시 붙어 봐요!`),
      ], v),
    );
  }

  if (v.mvp && v.mvpGoals >= 2) lines.push(`${j(v.mvp, '이/가')} ${v.mvpGoals}골을 넣으며 최고의 활약을 펼쳤어요!`);
  else if (v.mvp) lines.push(`${v.mvp}의 골이 특히 빛났어요.`);
  if (v.topKeeper && v.saves >= 3) lines.push(`골키퍼 ${v.topKeeper}의 선방도 대단했어요! 🧤`);
  if (v.shots >= 12) lines.push(`슈팅이 ${v.shots}개나 나온 화끈한 공격 축구였어요!`);
  return lines.join(' ');
}
