// 제미나이 끊김 개선: 재시도 / 생각 설정 / 다음 구간 미리 받기 검증
import { describe, expect, it } from 'vitest';
import { isTransientError, withRetry } from './engine';
import { geminiThinkingConfig } from './providers';
import { buildSegmentContext, contextKey, init, reducer, stateAfterSegment } from '../hooks/useMatch';
import { createDemoTeams } from '../store/demoTeams';
import { eventId } from '../domain/match';

describe('일시 오류 재시도', () => {
  it('서버 혼잡·시간 초과·응답 잘림은 다시 시도한다', () => {
    expect(isTransientError(new Error('{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}'))).toBe(true);
    expect(isTransientError(new Error('Request timed out'))).toBe(true);
    expect(isTransientError(new Error('제미나이 응답이 길이 제한으로 잘렸어요 (truncated).'))).toBe(true);
    expect(isTransientError(new SyntaxError('Unexpected end of JSON input'))).toBe(true);
  });
  it('키 오류·한도 0·사용량 초과(429)는 바로 다시 시도하지 않는다', () => {
    expect(isTransientError(new Error('429 RESOURCE_EXHAUSTED'))).toBe(false);
    expect(isTransientError(new Error('API key not valid'))).toBe(false);
    expect(isTransientError(new Error('429 Quota exceeded, limit: 0'))).toBe(false);
  });
  it('두 번 실패해도 세 번째에 성공하면 결과를 돌려준다', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('503 UNAVAILABLE');
      return 'ok';
    }, [1, 1]);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
  it('영구 오류는 바로 던진다', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error('API key not valid'); }, [1, 1])).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('제미나이 생각(thinking) 설정', () => {
  it('모델별로 최소 설정을 고른다', () => {
    expect(geminiThinkingConfig('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(geminiThinkingConfig('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
    expect(geminiThinkingConfig('gemini-2.5-pro')).toEqual({ thinkingBudget: 128 });
    expect(geminiThinkingConfig('gemini-3-flash-preview')).toEqual({ thinkingLevel: 'LOW' });
    expect(geminiThinkingConfig('gemini-2.0-flash')).toBeUndefined();
  });
});

describe('다음 구간 미리 받기', () => {
  const kickedOff = () => {
    const [home, away] = createDemoTeams();
    let s = reducer(init({ home, away }), { type: 'KICKOFF' });
    s = reducer(s, { type: 'FETCH_START' });
    const pid = s.home.lineup.slots.fw1!;
    return reducer(s, {
      type: 'FETCH_DONE',
      result: { events: [{ id: eventId(), minute: 7, type: 'goal', side: 'home', playerId: pid, text: '골!', highlight: true }] },
    });
  };

  it('끼어든 것이 없으면 미리 만든 상황과 실제 상황이 같다', () => {
    const s = kickedOff();
    const predicted = contextKey(buildSegmentContext(stateAfterSegment(s)));
    let real = reducer(s, { type: 'REVEAL' });
    real = reducer(real, { type: 'SEGMENT_END' });
    expect(real.segIndex).toBe(1);
    expect(contextKey(buildSegmentContext(real))).toBe(predicted);
  });

  it('작전 타임에 교체하면 미리 받은 결과를 쓰지 않는다', () => {
    const s = kickedOff();
    const predicted = contextKey(buildSegmentContext(stateAfterSegment(s)));
    let real = reducer(s, { type: 'REQUEST_TIMEOUT' });
    real = reducer(real, { type: 'REVEAL' });
    real = reducer(real, { type: 'SEGMENT_END' });
    const slots = { ...real.home.lineup.slots, fw1: real.home.lineup.slots.mf1, mf1: real.home.lineup.slots.fw1 };
    real = reducer(real, { type: 'UPDATE_SIDE', side: 'home', next: { ...real.home, lineup: { ...real.home.lineup, slots } }, log: '포지션 변경' });
    expect(contextKey(buildSegmentContext(real))).not.toBe(predicted);
  });
});
