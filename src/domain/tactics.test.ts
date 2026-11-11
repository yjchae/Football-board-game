import { describe, expect, it } from 'vitest';
import {
  activeTactic,
  analyzeTactic,
  MATCHUPS,
  NEUTRAL,
  normalizeTactic,
  parseTactic,
  TACTIC_CHIPS,
  TACTIC_MAX,
  tacticModifiers,
  tacticStatus,
  type Modifiers,
  type ParsedTactic,
  type TacticKey,
} from './tactics';

// ─────────────────────────────────────────────
// 감독 전술 노트: 해석·보정 단위 테스트 (06 문서 7-4절 T1~T6)
// ─────────────────────────────────────────────

const parsed = (keys: TacticKey[], boosted: TacticKey[] = []): ParsedTactic => ({ keys, boosted, conflictCancelled: false });
const BALANCED = parsed([]);

describe('T1 전술 해석 예시 (4-3절)', () => {
  const cases: [string, string, TacticKey[]][] = [
    ['P1', '공격적으로 몰아붙이자! 측면으로 크로스', ['attacking', 'wing']],
    ['P2', '수비수는 올라가지 말고 역습', ['counter']],
    ['P3', '공격적으로 하다가 수비적으로', []],
    ['P4', '롱볼 말고 짧은 패스로 점유하자', ['possession']],
    ['P5', '엄청 강하게 압박!', ['press']],
    ['P6', '', []],
    ['P7', '상대 역습 조심하자', []],
    ['P8', '로운한테 공 몰아줘', []],
    ['P9', '측면공격! 가운데로 드리블 돌파! 길게 롱볼! 압박!', ['center', 'longball', 'wing']],
    ['P10', '평소처럼 균형 있게!', []],
  ];
  it.each(cases)('%s "%s"', (_id, text, keys) => {
    expect(parseTactic(text)).toEqual(keys);
  });

  it('P3 반대 전술 1:1이면 둘 다 버리고 상쇄 표시', () => {
    expect(analyzeTactic('공격적으로 하다가 수비적으로').conflictCancelled).toBe(true);
    // 횟수가 많은 쪽은 남는다
    expect(analyzeTactic('공격! 공격! 수비').keys).toEqual(['attacking']);
  });

  it('부정어: 키워드 뒤 5글자 안의 "말고/금지/않"은 무효', () => {
    expect(parseTactic('수비 하지 마')).toEqual([]); // 공백을 지우고 비교
    expect(parseTactic('수비하지마')).toEqual([]);
    expect(parseTactic('롱볼 금지')).toEqual([]);
    expect(parseTactic('압박은 하지 않기')).toEqual([]);
  });

  it('상대 대비: "상대 공격을 막아" → 우리 수비 전술', () => {
    expect(parseTactic('상대 공격을 막아')).toEqual(['defensive']);
  });

  it('제외어: 선수 이름표(공격수·수비수)는 전술로 세지 않는다', () => {
    expect(parseTactic('공격수랑 수비수 모두 화이팅')).toEqual([]);
  });
});

describe('T2 빠른 선택 칩', () => {
  it('칩은 9개이고 id가 고유하다', () => {
    expect(TACTIC_CHIPS).toHaveLength(9);
    expect(new Set(TACTIC_CHIPS.map((c) => c.id)).size).toBe(9);
    expect(TACTIC_CHIPS.map((c) => c.id)).toEqual(['attack', 'defend', 'counter', 'possess', 'press', 'wing', 'center', 'longball', 'balance']);
  });
  it.each(TACTIC_CHIPS.map((c) => [c.id, c] as const))('%s 칩 문장은 자기 키 하나만 인식', (_id, chip) => {
    expect(parseTactic(chip.sentence)).toEqual(chip.key === 'balanced' ? [] : [chip.key]);
  });
});

describe('T3 최대 3개 + 상한', () => {
  const words = ['공격', '수비', '역습', '점유', '압박', '측면', '중앙', '롱볼', '균형'];
  const flood = words.flatMap((w) => Array(10).fill(w)).join(' ');

  it('모든 키워드를 섞은 긴 글도 키는 최대 3개', () => {
    expect(parseTactic(flood).length).toBeLessThanOrEqual(3);
  });

  it('어떤 3개 조합 + 상성이 겹쳐도 모든 보정값이 상한 안', () => {
    const keys: TacticKey[] = ['attacking', 'defensive', 'counter', 'possession', 'press', 'wing', 'center', 'longball'];
    const combos: TacticKey[][] = [];
    for (let a = 0; a < keys.length; a++)
      for (let b = a + 1; b < keys.length; b++) for (let c = b + 1; c < keys.length; c++) combos.push([keys[a], keys[b], keys[c]]);
    const within = (m: Modifiers) => {
      expect(Math.abs(m.controlAdd)).toBeLessThanOrEqual(0.05 + 1e-9);
      for (const f of ['chancesMul', 'concedeMul'] as const) expect(m[f]).toBeGreaterThanOrEqual(0.8 - 1e-9), expect(m[f]).toBeLessThanOrEqual(1.25 + 1e-9);
      for (const f of ['goalAdd', 'concedeGoalAdd'] as const) expect(Math.abs(m[f])).toBeLessThanOrEqual(0.03 + 1e-9);
      expect(m.foulMul).toBeGreaterThanOrEqual(0.7), expect(m.foulMul).toBeLessThanOrEqual(1.5);
      expect(m.cardMul).toBeGreaterThanOrEqual(0.8), expect(m.cardMul).toBeLessThanOrEqual(1.5);
      expect(m.cornerMul).toBeGreaterThanOrEqual(0.7), expect(m.cornerMul).toBeLessThanOrEqual(1.6);
      expect(m.offsideMul).toBeGreaterThanOrEqual(0.7), expect(m.offsideMul).toBeLessThanOrEqual(1.8);
    };
    for (const mine of combos) {
      for (const theirs of [combos[0], combos[17], combos[40]]) within(tacticModifiers(parsed(mine, mine), parsed(theirs)));
    }
    within(tacticModifiers(analyzeTactic(flood), analyzeTactic(flood)));
  });

  it('균형끼리는 보정이 전혀 없다 (기존 엔진과 동일 결과의 전제)', () => {
    expect(tacticModifiers(BALANCED, BALANCED)).toEqual(NEUTRAL);
    expect(tacticModifiers(analyzeTactic('평소처럼 균형 있게!'), analyzeTactic(''))).toEqual(NEUTRAL);
  });

  it('팀장 결정: 공격적 전술 보정은 기회 1.12 / 골 0 / 실점 쪽 1.06 / +0.006', () => {
    const m = tacticModifiers(parsed(['attacking']), BALANCED);
    expect(m.concedeMul).toBeCloseTo(1.06, 10);
    expect(m.concedeGoalAdd).toBeCloseTo(0.006, 10);
    expect(m.chancesMul).toBeCloseTo(1.12, 10);
    expect(m.goalAdd).toBe(0);
  });
});

describe('T4 상성은 홈/원정을 바꿔도 같다', () => {
  it.each(MATCHUPS.map((m) => [m.id, m] as const))('%s', (_id, m) => {
    const win = parsed([m.winner]);
    const lose = parsed([m.loser]);
    const winnerAlone = tacticModifiers(win, BALANCED);
    const loserAlone = tacticModifiers(lose, BALANCED);
    const winner = tacticModifiers(win, lose);
    const loser = tacticModifiers(lose, win);
    // 상성 보정이 실제로 걸린다
    expect(JSON.stringify(winner) !== JSON.stringify(winnerAlone) || JSON.stringify(loser) !== JSON.stringify(loserAlone)).toBe(true);
    // 함수는 "내 팀 / 상대 팀"만 보므로 자리를 바꿔 불러도 같은 값
    expect(tacticModifiers(win, lose)).toEqual(winner);
    expect(tacticModifiers(lose, win)).toEqual(loser);
  });

  it('M4 역습 vs 공격적: 역습 팀 기회 +0.10, 골 +0.01', () => {
    const m = tacticModifiers(parsed(['counter']), parsed(['attacking']));
    expect(m.chancesMul).toBeCloseTo(1 - 0.12 + 0.1, 10);
    expect(m.goalAdd).toBeCloseTo(0.02 + 0.01, 10);
  });
});

describe('T5 강조어', () => {
  it('"엄청 압박" → press 변화량이 정확히 1.25배', () => {
    const p = analyzeTactic('엄청 압박');
    expect(p.keys).toEqual(['press']);
    expect(p.boosted).toEqual(['press']);
    const plain = tacticModifiers(analyzeTactic('압박'), BALANCED);
    const strong = tacticModifiers(p, BALANCED);
    expect(strong.foulMul - 1).toBeCloseTo((plain.foulMul - 1) * 1.25, 10);
    expect(strong.cardMul - 1).toBeCloseTo((plain.cardMul - 1) * 1.25, 10);
    expect(strong.controlAdd).toBeCloseTo(plain.controlAdd * 1.25, 10);
  });
});

describe('T6 글 정리와 상태', () => {
  it('200자 초과 입력은 200자로 잘리고, 줄바꿈은 공백', () => {
    expect(normalizeTactic('가'.repeat(250))).toHaveLength(TACTIC_MAX);
    expect(normalizeTactic('  측면\n크로스  ')).toBe('측면 크로스');
  });
  it('빈 글은 미작성과 같다', () => {
    expect(tacticStatus({ first: '' }, 1)).toBe('empty');
    expect(tacticStatus({}, 1)).toBe('empty');
    expect(tacticStatus({ first: '역습' }, 1)).toBe('saved');
  });
  it('하프타임 상태: 유지 / 다시 저장 / 지움', () => {
    expect(tacticStatus({ first: '역습' }, 2)).toBe('kept');
    expect(tacticStatus({ first: '역습', second: '역습' }, 2)).toBe('resaved');
    expect(tacticStatus({ first: '역습', second: '' }, 2)).toBe('empty');
    expect(tacticStatus({}, 2)).toBe('empty');
  });
  it('후반엔 후반 노트, 없으면 전반 노트를 쓴다', () => {
    expect(activeTactic({ first: 'A' }, 1)).toBe('A');
    expect(activeTactic({ first: 'A' }, 2)).toBe('A');
    expect(activeTactic({ first: 'A', second: 'B' }, 2)).toBe('B');
    expect(activeTactic({ first: 'A', second: '' }, 2)).toBe('');
    expect(activeTactic({}, 2)).toBe('');
  });
});
