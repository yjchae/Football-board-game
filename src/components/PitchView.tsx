import type { MatchEvent, Side } from '../domain/types';
import type { MatchSide } from '../domain/match';

// 경기 이벤트로 공 위치(%)와 상황 라벨을 정하는 구장 평면도.
// 홈은 오른쪽 골대, 어웨이는 왼쪽 골대를 공격한다.

/** 이벤트 종류별 [공격 방향 진행도 0~100, 세로 y(%) (null이면 중앙 근처), 라벨] */
const SPOT: Record<string, [number, number | null, string]> = {
  goal: [95, 50, '⚽ 골!'],
  shot: [86, null, '슛!'],
  save: [8, 50, '선방!'],
  chance: [76, null, '찬스'],
  corner: [98, 6, '코너킥'],
  foul: [58, null, '파울'],
  offside: [72, null, '오프사이드'],
  yellow: [55, null, '옐로카드'],
  red: [55, null, '레드카드'],
  injury: [50, null, '부상'],
};

/** 문자열 → 0~1 값 (같은 이벤트면 항상 같은 값) */
function hash01(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}

export interface BallSpot {
  x: number;
  y: number;
  label: string;
  /** 공격 중인 팀 (없으면 중앙) */
  side: Side | null;
}

export function ballSpot(event?: MatchEvent): BallSpot {
  if (!event || event.side === null || !SPOT[event.type]) {
    return { x: 50, y: 50, label: event?.type === 'sub' ? '선수 교체' : '', side: null };
  }
  const [progress, fixedY, label] = SPOT[event.type];
  const j = hash01(event.id);
  const a = Math.min(97, Math.max(3, progress + (j - 0.5) * 6));
  const y = fixedY === null ? 25 + hash01(event.id + 'y') * 50 : fixedY + (j - 0.5) * (fixedY === 50 ? 16 : 0);
  const cornerY = event.type === 'corner' && j > 0.5 ? 100 - y : y;
  return { x: event.side === 'home' ? a : 100 - a, y: cornerY, label, side: event.side };
}

export function PitchView({ events, sides }: { events: MatchEvent[]; sides: Record<Side, MatchSide> }) {
  const spot = ballSpot(events[events.length - 1]);
  const team = spot.side ? sides[spot.side].team : null;
  const label = spot.label || (team ? '' : '킥오프');
  const dir = spot.side === 'home' ? '▶' : spot.side === 'away' ? '◀' : '';

  return (
    <div className="livepitch" data-testid="livepitch" role="img" aria-label="경기장 공 위치">
      <svg className="livepitch__svg" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <rect key={i} x={i * 10} y="0" width="10" height="60" fill={i % 2 ? '#2a7a3c' : '#2f8643'} />
        ))}
        <g fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.35">
          <rect x="1" y="1" width="98" height="58" />
          <line x1="50" y1="1" x2="50" y2="59" />
          <circle cx="50" cy="30" r="7" />
          <rect x="1" y="14" width="14" height="32" />
          <rect x="85" y="14" width="14" height="32" />
          <rect x="1" y="23" width="5" height="14" />
          <rect x="94" y="23" width="5" height="14" />
        </g>
        <rect x="0" y="26" width="1" height="8" fill="#fff" />
        <rect x="99" y="26" width="1" height="8" fill="#fff" />
      </svg>
      {label && (
        <div className="livepitch__label" style={team ? ({ '--team': team.color } as React.CSSProperties) : undefined}>
          {team ? `${dir} ${team.name} ${label}` : label}
        </div>
      )}
      <span className="livepitch__ball" style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>⚽</span>
    </div>
  );
}
