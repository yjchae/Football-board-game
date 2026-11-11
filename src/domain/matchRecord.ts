import { scoreOf, type MatchSide } from './match';
import type { MatchEvent, MatchRecord, Team } from './types';

// ─────────────────────────────────────────────
// 끝난 경기 → 저장용 경기 기록
// 팀이 나중에 지워지거나 이름이 바뀌어도 기록은 그때 모습 그대로 보이게
// 팀 이름·엠블럼·색과 득점자 이름을 복사해 둔다.
// ─────────────────────────────────────────────

const recordTeam = (t: Team) => ({ name: t.name, emoji: t.emoji, color: t.color });

export function buildMatchRecord(
  id: string,
  sides: { home: MatchSide; away: MatchSide },
  events: MatchEvent[],
  playedAt: Date = new Date(),
): MatchRecord {
  const nameOf = (e: MatchEvent) =>
    (e.side && sides[e.side].team.players.find((p) => p.id === e.playerId)?.name) || '알 수 없음';

  return {
    id,
    playedAt: playedAt.toISOString(),
    home: recordTeam(sides.home.team),
    away: recordTeam(sides.away.team),
    score: scoreOf(events),
    scorers: events
      .filter((e) => e.type === 'goal' && e.side)
      .map((e) => ({ side: e.side!, name: nameOf(e), minute: e.minute })),
  };
}

/** 기록 카드에 쓸 결과 문구 */
export function recordResult(r: MatchRecord): string {
  if (r.score.home === r.score.away) return '무승부';
  const winner = r.score.home > r.score.away ? r.home : r.away;
  return `${winner.name} 승리`;
}
