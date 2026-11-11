// ─────────────────────────────────────────────
// 감독 전술 노트: 아이가 글로 적은 작전을 해석하는 순수 모듈
//   1) parseTactic / analyzeTactic: 글 → 전술 키 (키워드 사전 + 해석 규칙)
//   2) tacticModifiers:            양 팀 전술 → 보정값 (합산 → 상성 → 상한)
//   3) 화면용 상수·헬퍼:            칩, 이름표, 카드 상태
// 기준 문서: docs/06-기획자-전술기능-기획서.md 4~5장
// ─────────────────────────────────────────────

export type TacticKey =
  | 'balanced'
  | 'attacking'
  | 'defensive'
  | 'counter'
  | 'possession'
  | 'press'
  | 'wing'
  | 'center'
  | 'longball';

export type Half = 1 | 2;

/** 한 팀의 전술 노트 (second가 없으면 후반에도 first를 쓴다) */
export interface TacticNote {
  first?: string;
  second?: string;
}

export interface ParsedTactic {
  /** 보정에 쓰는 키 (최대 3개, 'balanced'는 넣지 않음 → 비어 있으면 균형) */
  keys: TacticKey[];
  /** 강조어(엄청·아주…)가 붙은 키 */
  boosted: TacticKey[];
  /** 반대 전술끼리 상쇄가 일어났는지 (미리보기 안내용) */
  conflictCancelled: boolean;
}

export interface Modifiers {
  controlAdd: number; // 중원 점유 보정 (내 control에 +, 상대 control에 −)
  chancesMul: number; // 내 공격 기회 배율
  concedeMul: number; // 상대 공격 기회 배율 (내가 상대에게 주는 기회)
  goalAdd: number; // 내 슈팅의 골 확률 가산
  concedeGoalAdd: number; // 상대 슈팅의 골 확률 가산 (내 수비 허술함)
  foulMul: number; // 내 파울 발생 확률 배율
  cardMul: number; // 내 파울이 카드가 될 확률 배율
  cornerMul: number; // 내 코너킥 확률 배율
  offsideMul: number; // 내 오프사이드 확률 배율
}

export const TACTIC_MAX = 200;

/** 아무 전술도 없을 때 (균형) — 엔진이 이 값이면 기존 계산과 완전히 같다 */
export const NEUTRAL: Readonly<Modifiers> = Object.freeze({
  controlAdd: 0,
  chancesMul: 1,
  concedeMul: 1,
  goalAdd: 0,
  concedeGoalAdd: 0,
  foulMul: 1,
  cardMul: 1,
  cornerMul: 1,
  offsideMul: 1,
});

// ─────────────── 화면용 이름표 / 빠른 선택 칩 ───────────────

export const TACTIC_INFO: Record<TacticKey, { label: string; emoji: string }> = {
  balanced: { label: '균형', emoji: '⚖️' },
  attacking: { label: '공격적', emoji: '⚔️' },
  defensive: { label: '수비적', emoji: '🛡️' },
  counter: { label: '역습', emoji: '⚡' },
  possession: { label: '점유율', emoji: '🎯' },
  press: { label: '강한 압박', emoji: '🔥' },
  wing: { label: '측면 공격', emoji: '🪽' },
  center: { label: '중앙 돌파', emoji: '🏹' },
  longball: { label: '롱볼', emoji: '🚀' },
};

export const tacticLabel = (key: TacticKey) => `${TACTIC_INFO[key].emoji} ${TACTIC_INFO[key].label}`;

export interface TacticChip {
  /** data-testid용 영문 id (tactic-chip-<id>) */
  id: string;
  key: TacticKey;
  /** 누르면 글 끝에 덧붙는 문장 (자기 키워드 2개 이상, 다른 키워드 없음) */
  sentence: string;
}

export const TACTIC_CHIPS: readonly TacticChip[] = [
  { id: 'attack', key: 'attacking', sentence: '공격적으로 몰아붙이자!' },
  { id: 'defend', key: 'defensive', sentence: '수비를 단단하게 지키자!' },
  { id: 'counter', key: 'counter', sentence: '공을 잡으면 빠르게 역습! 뒷공간을 노려!' },
  { id: 'possess', key: 'possession', sentence: '짧은 패스로 공을 오래 갖자!' },
  { id: 'press', key: 'press', sentence: '앞에서부터 강하게 압박! 공을 뺏어!' },
  { id: 'wing', key: 'wing', sentence: '측면으로 달려서 크로스!' },
  { id: 'center', key: 'center', sentence: '가운데로 드리블 돌파!' },
  { id: 'longball', key: 'longball', sentence: '길게 한 번에 롱볼!' },
  { id: 'balance', key: 'balanced', sentence: '평소처럼 균형 있게!' },
];

/** 카드 상태 (화면 표시용) */
export type TacticStatus = 'empty' | 'saved' | 'kept' | 'resaved';

export function tacticStatus(note: TacticNote, half: Half): TacticStatus {
  if (half === 1) return note.first ? 'saved' : 'empty';
  if (note.second !== undefined) return note.second ? 'resaved' : 'empty';
  return note.first ? 'kept' : 'empty';
}

/** 지금 하프에 적용되는 전술 원문 (후반엔 후반 노트, 없으면 전반 노트) */
export function activeTactic(note: TacticNote, half: Half): string {
  return (half === 2 ? (note.second ?? note.first) : note.first) ?? '';
}

/** 저장 전에 글을 다듬는다: 앞뒤 공백 제거, 줄바꿈 → 공백, 200자 자르기 */
export function normalizeTactic(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim().slice(0, TACTIC_MAX);
}

// ─────────────── 키워드 사전 (06 문서 4-1절) ───────────────

const KEYWORDS: Record<TacticKey, string[]> = {
  attacking: ['공격적', '공격', '닥공', '닥치고공격', '총공격', '몰아붙', '몰아쳐', '맹공', '공세', '전진', '올라가', '슛많이', '슈팅많이', '골많이', '적극적'],
  // '실점하지않'·'실점안'은 부정 어미가 키워드 안에 들어 있는 복합어 (뒤의 '않'에 무효화되지 않도록 통째로 등록)
  defensive: ['수비적', '수비', '지키', '지켜', '막아', '잠그', '잠가', '버스', '텐백', '철벽', '단단하게', '내려서', '뒤로내려', '안전하게', '실점하지않', '실점안', '골안먹'],
  counter: ['역습', '카운터', 'counter', '반격', '속공', '기습', '뒷공간', '빈틈노려', '빠르게치고', '역습공격'],
  possession: ['점유', '짧은패스', '패스많이', '패스플레이', '패스로', '티키타카', '빌드업', '공소유', '볼소유', '공을오래', '천천히'],
  press: ['압박', '프레싱', '프레스', 'pressing', '강하게달려', '공뺏', '뺏어', '빼앗', '몸싸움', '거칠게', '압박수비'],
  wing: ['측면', '사이드', '윙', '날개', '크로스', '양쪽', '옆으로', '터치라인', '측면공격'],
  center: ['중앙', '가운데', '정면돌파', '돌파', '스루패스', '드리블', '개인기', '중앙공격'],
  longball: ['롱볼', 'longball', '롱패스', '긴패스', '길게', '한번에', '멀리차', '뻥', '높은공', '헤딩', '롱볼공격'],
  balanced: ['균형', '밸런스', '평소대로', '평소처럼', '기본대로'],
};

/** 선수를 부르는 말 → 전술로 세지 않는다 */
const EXCLUDED = ['공격수', '수비수', '미드필더', '골키퍼', '측면수비'];
// 공백을 지우고 비교하므로 "하지 말자"·"안 돼"도 잡힌다
const NEGATIONS = ['말고', '하지마', '하지말', '안해', '안돼', '안되', '금지', '빼고', '않', '싫어'];
const GUARD_WORDS = ['막', '조심', '대비', '주의'];
const EMPHASIS = ['아주', '엄청', '완전', '매우', '정말', '최대한', '무조건'];
const BOOST = 1.25;

/** 반대 전술 쌍: 둘 다 있으면 많은 쪽만 남긴다 */
const OPPOSITES: [TacticKey, TacticKey][] = [
  ['attacking', 'defensive'],
  ['possession', 'longball'],
  ['possession', 'counter'],
];

/** 긴 키워드부터 찾는다 (복합어 '측면공격'이 '공격'보다 먼저 차지하도록) */
const DICTIONARY: { word: string; key: TacticKey | null }[] = [
  ...EXCLUDED.map((word) => ({ word, key: null })),
  ...(Object.entries(KEYWORDS) as [TacticKey, string[]][]).flatMap(([key, words]) => words.map((word) => ({ word, key }))),
].sort((a, b) => b.word.length - a.word.length);

interface Hit {
  key: TacticKey;
  start: number;
  end: number;
}

const hasAny = (text: string, words: string[]) => words.some((w) => text.includes(w));
/** 키워드 바로 앞 5글자 */
const before = (compact: string, h: Hit) => compact.slice(Math.max(0, h.start - 5), h.start);

/** 3·4·5단계: 최장 일치로 키워드를 찾고, 부정·상대 대비 표현은 무효 처리 */
function findHits(compact: string): Hit[] {
  const taken = new Array<boolean>(compact.length).fill(false);
  const all: Hit[] = [];
  for (const { word, key } of DICTIONARY) {
    for (let at = compact.indexOf(word); at >= 0; at = compact.indexOf(word, at + 1)) {
      const end = at + word.length;
      if (taken.slice(at, end).some(Boolean)) continue;
      taken.fill(true, at, end);
      if (key) all.push({ key, start: at, end });
    }
  }
  all.sort((a, b) => a.start - b.start);

  return all.filter((h) => {
    if (hasAny(compact.slice(h.end, h.end + 5), NEGATIONS)) return false;
    const guarded = before(compact, h).includes('상대') && hasAny(compact.slice(h.end, h.end + 6), GUARD_WORDS);
    return !guarded;
  });
}

/** 글 → 전술 해석 결과 (06 문서 4-2절 규칙 순서대로) */
export function analyzeTactic(text: string): ParsedTactic {
  const compact = normalizeTactic(text).replace(/\s+/g, '').toLowerCase();
  const valid = findHits(compact);

  // 6단계: 키마다 횟수와 처음 나온 위치
  const count = new Map<TacticKey, number>();
  const firstAt = new Map<TacticKey, number>();
  for (const h of valid) {
    count.set(h.key, (count.get(h.key) ?? 0) + 1);
    if (!firstAt.has(h.key)) firstAt.set(h.key, h.start);
  }

  // 7단계: 반대 전술 상쇄
  let conflictCancelled = false;
  for (const [a, b] of OPPOSITES) {
    const ca = count.get(a) ?? 0;
    const cb = count.get(b) ?? 0;
    if (!ca || !cb) continue;
    if (ca <= cb) count.delete(a);
    if (cb <= ca) count.delete(b);
    if (ca === cb) conflictCancelled = true;
  }

  // 8단계: 횟수 많은 순 → 먼저 나온 순, 최대 3개 ('balanced'는 보정이 없으므로 뺀다)
  const keys = [...count.keys()]
    .filter((k) => k !== 'balanced')
    .sort((a, b) => count.get(b)! - count.get(a)! || firstAt.get(a)! - firstAt.get(b)!)
    .slice(0, 3);

  // 9단계: 강조어
  const boosted = keys.filter((k) =>
    valid.some((h) => h.key === k && hasAny(before(compact, h), EMPHASIS)),
  );
  return { keys, boosted, conflictCancelled };
}

/** 글 → 전술 키 목록 (최대 3개, 비어 있으면 균형) */
export function parseTactic(text: string): TacticKey[] {
  return analyzeTactic(text).keys;
}

// ─────────────── 보정값 (06 문서 5-2절) ───────────────
// 배율은 1 대신 "변화량"으로 적는다 (예: chancesMul 1.15 → +0.15).
// 팀장 결정: attacking의 concedeMul 1.10→1.06, concedeGoalAdd +0.010→+0.006 (공격적끼리 총득점 과다 방지)
// QA-T1 반영: attacking의 chancesMul 1.15→1.12, goalAdd +0.005→0 (공격적끼리 총득점 ≤ 5.0골, 실점 +10% 이상 유지)

type Delta = Partial<Modifiers>;

const KEY_DELTA: Record<TacticKey, Delta> = {
  balanced: {},
  attacking: { chancesMul: 0.12, concedeMul: 0.06, goalAdd: 0, concedeGoalAdd: 0.006 },
  defensive: { chancesMul: -0.15, concedeMul: -0.12, goalAdd: -0.005, concedeGoalAdd: -0.012 },
  counter: { chancesMul: -0.12, concedeMul: -0.03, goalAdd: 0.02 },
  possession: { controlAdd: 0.04, goalAdd: -0.015, foulMul: -0.15 },
  press: { controlAdd: 0.025, concedeMul: -0.03, concedeGoalAdd: 0.012, foulMul: 0.3, cardMul: 0.25 },
  wing: { chancesMul: 0.04, goalAdd: -0.005, cornerMul: 0.5 },
  center: { controlAdd: 0.02, concedeMul: 0.05, goalAdd: 0.005, offsideMul: 0.2 },
  longball: { controlAdd: -0.03, chancesMul: 0.05, goalAdd: 0.005, offsideMul: 0.6 },
};

// ─────────────── 상성 (06 문서 5-3절) ───────────────

export interface Matchup {
  id: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
  winner: TacticKey;
  loser: TacticKey;
  winnerDelta: Delta;
  loserDelta: Delta;
  /** 종료 화면용 아이 설명 */
  text: string;
}

export const MATCHUPS: readonly Matchup[] = [
  { id: 'M1', winner: 'press', loser: 'possession', winnerDelta: {}, loserDelta: { controlAdd: -0.04 }, text: '강한 압박이 패스 길을 막았어요!' },
  { id: 'M2', winner: 'longball', loser: 'press', winnerDelta: { goalAdd: 0.01 }, loserDelta: { controlAdd: -0.025 }, text: '롱볼이 압박을 넘겨 뒷공간을 노렸어요!' },
  { id: 'M3', winner: 'possession', loser: 'longball', winnerDelta: {}, loserDelta: { chancesMul: -0.1 }, text: '공을 오래 가져서 롱볼 찬스가 줄었어요!' },
  { id: 'M4', winner: 'counter', loser: 'attacking', winnerDelta: { chancesMul: 0.1, goalAdd: 0.01 }, loserDelta: {}, text: '다 같이 올라간 틈을 역습이 찔렀어요!' },
  { id: 'M5', winner: 'wing', loser: 'defensive', winnerDelta: {}, loserDelta: { concedeMul: 0.05, concedeGoalAdd: 0.015 }, text: '가운데만 지키다 측면이 뚫렸어요!' },
];

/** mine이 theirs를 상대로 이기는 상성 목록 */
export function winningMatchups(mine: TacticKey[], theirs: TacticKey[]): Matchup[] {
  return MATCHUPS.filter((m) => mine.includes(m.winner) && theirs.includes(m.loser));
}

// ─────────────── 합산과 상한 (06 문서 5-4절) ───────────────

const LIMITS: Record<keyof Modifiers, [number, number]> = {
  controlAdd: [-0.05, 0.05],
  chancesMul: [0.8, 1.25],
  concedeMul: [0.8, 1.25],
  goalAdd: [-0.03, 0.03],
  concedeGoalAdd: [-0.03, 0.03],
  foulMul: [0.7, 1.5],
  cardMul: [0.8, 1.5],
  cornerMul: [0.7, 1.6],
  offsideMul: [0.7, 1.8],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function addDelta(target: Modifiers, delta: Delta, factor = 1) {
  for (const [field, value] of Object.entries(delta) as [keyof Modifiers, number][]) target[field] += value * factor;
}

/**
 * 내 전술과 상대 전술로 "내 팀" 보정값을 만든다.
 * 1) 고른 키의 변화량을 더하고(강조 ×1.25) 2) 상성을 얹고 3) 상한으로 자른다.
 * 둘 다 균형이면 NEUTRAL과 똑같은 값이 나온다.
 */
export function tacticModifiers(mine: ParsedTactic, theirs: ParsedTactic): Modifiers {
  const mods: Modifiers = { ...NEUTRAL };
  for (const key of mine.keys) addDelta(mods, KEY_DELTA[key], mine.boosted.includes(key) ? BOOST : 1);
  for (const m of winningMatchups(mine.keys, theirs.keys)) addDelta(mods, m.winnerDelta);
  for (const m of winningMatchups(theirs.keys, mine.keys)) addDelta(mods, m.loserDelta);
  for (const field of Object.keys(LIMITS) as (keyof Modifiers)[]) mods[field] = clamp(mods[field], ...LIMITS[field]);
  return mods;
}
