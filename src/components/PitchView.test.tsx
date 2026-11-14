import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../domain/types';
import { renderToString } from 'react-dom/server';
import { ballSpot, PitchView } from './PitchView';
import type { MatchSide } from '../domain/match';

const ev = (type: MatchEvent['type'], side: MatchEvent['side']): MatchEvent => ({
  id: 'e1', minute: 10, type, side, text: '', highlight: false,
});

describe('ballSpot', () => {
  it('홈 골은 오른쪽, 어웨이 골은 왼쪽 골문 쪽', () => {
    expect(ballSpot(ev('goal', 'home')).x).toBeGreaterThan(85);
    expect(ballSpot(ev('goal', 'away')).x).toBeLessThan(15);
  });
  it('이벤트가 없으면 중앙, 같은 이벤트는 같은 위치', () => {
    expect(ballSpot()).toMatchObject({ x: 50, y: 50 });
    expect(ballSpot(ev('shot', 'home'))).toEqual(ballSpot(ev('shot', 'home')));
  });
});

describe('PitchView', () => {
  it('렌더되고 공격 팀 이름이 라벨에 나온다', () => {
    const sides = { home: { team: { name: '홈FC', color: '#f00' } }, away: { team: { name: '어웨이FC', color: '#00f' } } } as unknown as Record<'home' | 'away', MatchSide>;
    const html = renderToString(<PitchView events={[ev('goal', 'home')]} sides={sides} />);
    expect(html).toContain('홈FC');
    expect(html).toContain('livepitch');
  });
});
