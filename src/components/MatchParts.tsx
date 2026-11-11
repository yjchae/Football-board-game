import { useState } from 'react';
import { changeFormation, FORMATIONS } from '../domain/formations';
import { applyDrop } from '../domain/lineupOps';
import { MAX_SUBS, type MatchSide } from '../domain/match';
import type { EventType, HalfSummary, MatchEvent, Player, Side } from '../domain/types';
import { LineupBoard } from './LineupBoard';
import { PlayerAvatar } from './PlayerCard';

// ─────────────────────────────────────────────
// 경기 화면 조각들: 전광판 / 중계 피드 / 하이라이트 / 하프 정리 / 교체 패널
// ─────────────────────────────────────────────

export const EVENT_ICON: Record<EventType, string> = {
  goal: '⚽',
  shot: '🎯',
  save: '🧤',
  chance: '💨',
  foul: '⚠️',
  yellow: '🟨',
  red: '🟥',
  injury: '🚑',
  corner: '🚩',
  offside: '🙅',
  sub: '🔁',
  info: '📣',
};

export function findPlayer(sides: { home: MatchSide; away: MatchSide }, id?: string): Player | undefined {
  if (!id) return undefined;
  return sides.home.team.players.find((p) => p.id === id) ?? sides.away.team.players.find((p) => p.id === id);
}

// ─────────────── 전광판 ───────────────

interface ScoreboardProps {
  home: MatchSide;
  away: MatchSide;
  score: { home: number; away: number };
  clock: number;
  label: string;
}

export function Scoreboard({ home, away, score, clock, label }: ScoreboardProps) {
  return (
    <div className="scoreboard">
      <TeamBadge side={home} align="left" />
      <div className="scoreboard__center">
        <div className="scoreboard__score" data-testid="score">
          <span>{score.home}</span>
          <i>:</i>
          <span>{score.away}</span>
        </div>
        <div className="scoreboard__clock">
          <b>{clock}'</b> <span>{label}</span>
        </div>
        <div className="scoreboard__bar">
          <div style={{ width: `${(clock / 90) * 100}%` }} />
          <em style={{ left: '50%' }} />
        </div>
      </div>
      <TeamBadge side={away} align="right" />
    </div>
  );
}

function TeamBadge({ side, align }: { side: MatchSide; align: 'left' | 'right' }) {
  return (
    <div className={`tbadge tbadge--${align}`} style={{ '--team': side.team.color } as React.CSSProperties}>
      <span className="tbadge__emoji">{side.team.emoji}</span>
      <span className="tbadge__name">{side.team.name}</span>
    </div>
  );
}

// ─────────────── 중계 피드 ───────────────

export function EventFeed({ events, sides }: { events: MatchEvent[]; sides: { home: MatchSide; away: MatchSide } }) {
  const list = [...events].reverse();
  return (
    <ol className="feed" data-testid="feed">
      {list.map((e) => {
        const team = e.side ? sides[e.side].team : null;
        return (
          <li
            key={e.id}
            className={`feed__item feed__item--${e.type} ${e.highlight ? 'feed__item--hl' : ''}`}
            style={team ? ({ '--team': team.color } as React.CSSProperties) : undefined}
          >
            <span className="feed__min">{e.minute}'</span>
            <span className="feed__icon">{EVENT_ICON[e.type]}</span>
            <span className="feed__text">{e.text}</span>
            {team && <span className="feed__team">{team.emoji}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────── 하이라이트 연출 (골/명장면 순간) ───────────────

export function Spotlight({ event, sides }: { event: MatchEvent; sides: { home: MatchSide; away: MatchSide } }) {
  const player = findPlayer(sides, event.playerId);
  const team = event.side ? sides[event.side].team : null;
  const title = event.type === 'goal' ? 'GOAL!' : event.type === 'save' ? 'SUPER SAVE!' : event.type === 'red' ? 'RED CARD' : 'BIG CHANCE!';
  return (
    <div className="spotlight" style={{ '--team': team?.color ?? '#c6ff3d' } as React.CSSProperties} data-testid="spotlight">
      <div className="spotlight__burst" />
      <div className="spotlight__card">
        <div className="spotlight__title">{title}</div>
        {player && (
          <div className="spotlight__player">
            <PlayerAvatar player={player} size={84} />
            <div>
              <b>{player.name}</b>
              <span>{team?.emoji} {team?.name} · {event.minute}'</span>
            </div>
          </div>
        )}
        <p>{event.text}</p>
      </div>
    </div>
  );
}

// ─────────────── 하이라이트 모음 ───────────────

export function HighlightReel({ events, sides, title }: { events: MatchEvent[]; sides: { home: MatchSide; away: MatchSide }; title: string }) {
  const hl = events.filter((e) => e.highlight);
  return (
    <div className="reel">
      <h4>🎬 {title}</h4>
      {hl.length === 0 && <p className="muted small">아직 하이라이트가 없어요.</p>}
      <div className="reel__track">
        {hl.map((e, i) => {
          const player = findPlayer(sides, e.playerId);
          const team = e.side ? sides[e.side].team : null;
          return (
            <div key={e.id} className="reel__item" style={{ '--team': team?.color, animationDelay: `${i * 80}ms` } as React.CSSProperties}>
              <div className="reel__top">
                <span className="reel__min">{e.minute}'</span>
                <span>{EVENT_ICON[e.type]}</span>
              </div>
              {player && <PlayerAvatar player={player} size={48} />}
              <b>{player?.name ?? team?.name}</b>
              <p>{e.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────── 하프 정리 카드 ───────────────

const STAT_ROWS: { key: keyof HalfSummary['stats']['home']; label: string }[] = [
  { key: 'goals', label: '골' },
  { key: 'shots', label: '슈팅' },
  { key: 'saves', label: '선방' },
  { key: 'corners', label: '코너킥' },
  { key: 'fouls', label: '파울' },
  { key: 'yellows', label: '경고' },
  { key: 'reds', label: '퇴장' },
];

export function HalfSummaryCard({ summary, sides }: { summary: HalfSummary; sides: { home: MatchSide; away: MatchSide } }) {
  const mvp = findPlayer(sides, summary.mvpPlayerId);
  return (
    <article className="summary" data-testid={`summary-${summary.half}`}>
      <header>
        <span className="summary__tag">{summary.half === 1 ? '전반 정리' : '후반 정리'}</span>
        <h3>{summary.title}</h3>
        <div className="summary__score">
          {sides.home.team.emoji} {summary.score.home} : {summary.score.away} {sides.away.team.emoji}
        </div>
      </header>
      {summary.text && <p className="summary__text">{summary.text}</p>}
      <div className="summary__body">
        <table className="stat-table">
          <thead>
            <tr>
              <th>{sides.home.team.name}</th>
              <th />
              <th>{sides.away.team.name}</th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((r) => {
              const h = summary.stats.home[r.key];
              const a = summary.stats.away[r.key];
              return (
                <tr key={r.key}>
                  <td className={h > a ? 'win' : ''}>{h}</td>
                  <th>{r.label}</th>
                  <td className={a > h ? 'win' : ''}>{a}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {mvp && (
          <div className="mvp">
            <span className="mvp__tag">MVP</span>
            <PlayerAvatar player={mvp} size={64} />
            <b>{mvp.name}</b>
            <span className="muted small">{mvp.position} · OVR {mvp.overall}</span>
          </div>
        )}
      </div>
    </article>
  );
}

// ─────────────── 교체 / 포지션 정비 패널 ───────────────

interface TacticsProps {
  sides: { home: MatchSide; away: MatchSide };
  onUpdate(side: Side, next: MatchSide, log?: string): void;
  /** 킥오프 전: 교체가 아니라 자유롭게 선발을 바꾸는 단계 */
  beforeKickoff?: boolean;
}

export function TacticsPanel({ sides, onUpdate, beforeKickoff = false }: TacticsProps) {
  const [tab, setTab] = useState<Side>('home');
  const [message, setMessage] = useState<string | null>(null);
  const ms = sides[tab];
  const maxOnPitch = 11 - ms.sentOff.length;
  const name = (id: string) => ms.team.players.find((p) => p.id === id)?.name ?? '?';

  return (
    <div className="tactics">
      <div className="tabs">
        {(['home', 'away'] as Side[]).map((s) => (
          <button key={s} className={tab === s ? 'on' : ''} onClick={() => { setTab(s); setMessage(null); }}>
            {sides[s].team.emoji} {sides[s].team.name}
            <small>{beforeKickoff ? ' · 선발 정하기' : ` · 교체 ${MAX_SUBS - sides[s].subsUsed}회 남음`}</small>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="seg">
          {FORMATIONS.map((f) => (
            <button
              key={f.id}
              className={ms.lineup.formationId === f.id ? 'on' : ''}
              onClick={() => {
                // 같은 포메이션을 다시 누르면 기본 위치로만 되돌리고 중계 기록은 남기지 않는다
                const changed = ms.lineup.formationId !== f.id;
                const log = changed && !beforeKickoff ? `${ms.team.name} 포메이션 변경 → ${f.name}` : undefined;
                onUpdate(tab, { ...ms, lineup: changeFormation(ms.lineup, ms.team.players, f.id) }, log);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>
      {message && <p className="status status--error">{message}</p>}
      <LineupBoard
        players={ms.team.players}
        lineup={ms.lineup}
        color={ms.team.color}
        unavailable={ms.unavailable}
        injured={ms.injured}
        benchTitle={beforeKickoff ? '벤치' : '벤치 (끌어서 교체)'}
        onResetPositions={() => onUpdate(tab, { ...ms, lineup: { ...ms.lineup, positions: undefined } })}
        onDrop={(pid, target) => {
          const result = applyDrop(ms.lineup, pid, target, {
            matchMode: !beforeKickoff,
            subsLeft: MAX_SUBS - ms.subsUsed,
            maxOnPitch,
            unavailable: ms.unavailable,
          });
          setMessage(result.error ?? null);
          if (result.error) return;
          if (result.sub) {
            const { inId, outId } = result.sub;
            onUpdate(
              tab,
              {
                ...ms,
                lineup: result.lineup,
                subsUsed: ms.subsUsed + 1,
                unavailable: [...ms.unavailable, outId],
                injured: ms.injured.filter((id) => id !== outId),
              },
              `선수 교체: ${name(outId)} OUT ➜ ${name(inId)} IN`,
            );
          } else {
            onUpdate(tab, { ...ms, lineup: result.lineup });
          }
        }}
      />
    </div>
  );
}
