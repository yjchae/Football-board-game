import { useMemo, useState } from 'react';
import { createEngine, engineLabel } from '../ai/engine';
import {
  EventFeed,
  HalfSummaryCard,
  HighlightReel,
  Scoreboard,
  Spotlight,
  TacticsPanel,
} from '../components/MatchParts';
import { onPitchIds } from '../domain/formations';
import { isLastSegmentOfHalf, scoreOf, SEGMENTS } from '../domain/match';
import type { Team } from '../domain/types';
import { useMatch } from '../hooks/useMatch';
import { useStore } from '../store/useStore';

// ─────────────────────────────────────────────
// 경기 화면: 팀 선택 → 전반 → 하프타임(정리/교체) → 후반 → 종료
// ─────────────────────────────────────────────

export function MatchScreen({ goTeams }: { goTeams(): void }) {
  const teams = useStore((s) => s.teams);
  const [match, setMatch] = useState<{ home: Team; away: Team; key: number } | null>(null);

  if (match) {
    return <LiveMatch key={match.key} home={match.home} away={match.away} onExit={() => setMatch(null)} />;
  }
  return <MatchSetup teams={teams} goTeams={goTeams} onStart={(home, away) => setMatch({ home, away, key: Date.now() })} />;
}

// ─────────────── 경기 준비 ───────────────

function MatchSetup({ teams, goTeams, onStart }: { teams: Team[]; goTeams(): void; onStart(home: Team, away: Team): void }) {
  const settings = useStore((s) => s.settings);
  const [homeId, setHomeId] = useState(teams[0]?.id ?? '');
  const [awayId, setAwayId] = useState(teams[1]?.id ?? '');
  const home = teams.find((t) => t.id === homeId);
  const away = teams.find((t) => t.id === awayId);

  const problems: string[] = [];
  if (teams.length < 2) problems.push('경기를 하려면 팀이 2개 이상 필요해요.');
  if (home && away && home.id === away.id) problems.push('서로 다른 팀을 골라 주세요.');
  for (const t of [home, away]) {
    if (t && onPitchIds(t.lineup).length < 7) problems.push(`${t.name}: 선발 선수가 최소 7명 필요해요. (포지션 배치에서 설정)`);
  }

  return (
    <div className="setup">
      <h2 className="hero-title">
        킥오프 <span>준비</span>
      </h2>
      <div className="versus">
        <TeamPicker label="HOME" teams={teams} value={homeId} onChange={setHomeId} />
        <div className="versus__vs">VS</div>
        <TeamPicker label="AWAY" teams={teams} value={awayId} onChange={setAwayId} />
      </div>

      <div className="engine-chip">🤖 경기 진행: <b>{engineLabel(settings)}</b></div>

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="setup__actions">
        {teams.length < 2 && <button className="btn btn--ghost" onClick={goTeams}>팀 만들러 가기</button>}
        <button
          className="btn btn--primary btn--xl"
          disabled={problems.length > 0 || !home || !away}
          onClick={() => home && away && onStart(home, away)}
        >
          ⚽ 경기 시작
        </button>
      </div>
      <p className="muted small center">전반 45분 → 하프타임(교체·포지션 정비) → 후반 45분. 경기 중에도 ‘작전 타임’으로 교체할 수 있어요.</p>
    </div>
  );
}

function TeamPicker({ label, teams, value, onChange }: { label: string; teams: Team[]; value: string; onChange(id: string): void }) {
  const team = teams.find((t) => t.id === value);
  return (
    <label className="tpicker" style={{ '--team': team?.color ?? '#555' } as React.CSSProperties}>
      <span className="tpicker__label">{label}</span>
      <span className="tpicker__emoji">{team?.emoji ?? '❔'}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} 팀`}>
        <option value="">팀 선택</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
        ))}
      </select>
    </label>
  );
}

// ─────────────── 경기 진행 ───────────────

function LiveMatch({ home, away, onExit }: { home: Team; away: Team; onExit(): void }) {
  const settings = useStore((s) => s.settings);
  const [fallbackMsg, setFallbackMsg] = useState<string | null>(null);
  const engine = useMemo(
    () => createEngine(settings, (reason) => setFallbackMsg(`AI 연결 문제로 오프라인 엔진이 대신 진행했어요. ${reason}`)),
    // 경기 도중 설정이 바뀌어도 엔진은 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { state, kickoff, requestTimeout, resume, updateSide } = useMatch({ home, away }, engine, settings.playbackMs);
  const sides = { home: state.home, away: state.away };
  const score = scoreOf(state.events);
  const half = SEGMENTS[state.segIndex]?.half ?? 1;

  const phaseLabel = {
    ready: '경기 전',
    playing: half === 1 ? '전반전' : '후반전',
    timeout: '작전 타임',
    halftime: '하프타임',
    fulltime: '경기 종료',
  }[state.phase];

  const firstHalfEvents = state.events.filter((e) => e.minute <= 45);
  const secondHalfEvents = state.events.filter((e) => e.minute > 45);

  return (
    <div className="live">
      <Scoreboard home={state.home} away={state.away} score={score} clock={state.clock} label={phaseLabel} />

      {state.spotlight && <Spotlight event={state.spotlight} sides={sides} />}

      {/* 진행 중 상태 표시 */}
      <div className="live__status">
        {state.phase === 'playing' && state.fetching && (
          <span className="thinking"><i className="ball-spin">⚽</i> {engine.label}가 다음 장면을 만들고 있어요…</span>
        )}
        {state.phase === 'playing' && !state.fetching && (
          <span className="live-dot">LIVE · {engine.label}</span>
        )}
        {state.notice && <span className="status status--warn">{state.notice}</span>}
        {fallbackMsg && (
          <span className="status status--warn" onClick={() => setFallbackMsg(null)}>{fallbackMsg}</span>
        )}
      </div>

      {/* 단계별 메인 영역 */}
      {state.phase === 'ready' && (
        <div className="stage">
          <TacticsPanel sides={sides} beforeKickoff onUpdate={(s, next) => updateSide(s, next)} />
          <button className="btn btn--primary btn--xl btn--float" onClick={kickoff}>🎉 킥오프!</button>
        </div>
      )}

      {state.phase === 'playing' && (
        <div className="stage stage--play">
          <button className="btn btn--ghost btn--block" disabled={state.timeoutRequested} onClick={requestTimeout}>
            {!state.timeoutRequested
              ? '⏱️ 작전 타임 요청 (선수 교체)'
              : isLastSegmentOfHalf(state.segIndex)
                ? '⏱️ 곧 하프 종료! 그때 교체할 수 있어요'
                : '⏱️ 이번 구간이 끝나면 작전 타임!'}
          </button>
          <EventFeed events={state.events} sides={sides} />
        </div>
      )}

      {state.phase === 'timeout' && (
        <div className="stage">
          <h3 className="stage__title">⏱️ 작전 타임 — {state.clock}분</h3>
          <TacticsPanel sides={sides} onUpdate={updateSide} />
          <button className="btn btn--primary btn--xl btn--float" onClick={resume}>▶ 경기 재개</button>
        </div>
      )}

      {state.phase === 'halftime' && state.summaries[0] && (
        <div className="stage">
          <HalfSummaryCard summary={state.summaries[0]} sides={sides} />
          <HighlightReel events={firstHalfEvents} sides={sides} title="전반 하이라이트" />
          <h3 className="stage__title">🔁 하프타임 — 선수 교체 · 포지션 정비</h3>
          <TacticsPanel sides={sides} onUpdate={updateSide} />
          <button className="btn btn--primary btn--xl btn--float" onClick={kickoff} data-testid="start-second-half">
            ▶ 후반 시작
          </button>
        </div>
      )}

      {state.phase === 'fulltime' && (
        <div className="stage">
          <FinalBanner home={state.home.team} away={state.away.team} score={score} />
          {state.summaries[1] && <HalfSummaryCard summary={state.summaries[1]} sides={sides} />}
          <HighlightReel events={secondHalfEvents} sides={sides} title="후반 하이라이트" />
          {state.summaries[0] && <HalfSummaryCard summary={state.summaries[0]} sides={sides} />}
          <HighlightReel events={firstHalfEvents} sides={sides} title="전반 하이라이트" />
          <details className="full-log">
            <summary>📜 전체 중계 기록 보기</summary>
            <EventFeed events={state.events} sides={sides} />
          </details>
          <button className="btn btn--primary btn--xl" onClick={onExit}>🔄 새 경기</button>
        </div>
      )}

      {state.phase !== 'fulltime' && (
        <button className="btn btn--text" onClick={() => confirm('경기를 그만둘까요?') && onExit()}>경기 나가기</button>
      )}
    </div>
  );
}

function FinalBanner({ home, away, score }: { home: Team; away: Team; score: { home: number; away: number } }) {
  const winner = score.home === score.away ? null : score.home > score.away ? home : away;
  return (
    <div className="final" style={{ '--team': winner?.color ?? '#ffffff' } as React.CSSProperties} data-testid="final">
      <span className="final__tag">FULL TIME</span>
      <h2>{winner ? `${winner.emoji} ${winner.name} 승리!` : '🤝 무승부!'}</h2>
      <p>
        {home.name} <b>{score.home}</b> : <b>{score.away}</b> {away.name}
      </p>
    </div>
  );
}
