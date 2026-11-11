import { recordResult } from '../domain/matchRecord';
import type { MatchRecord, RecordTeam } from '../domain/types';
import { MAX_HISTORY, useStore } from '../store/useStore';

// ─────────────────────────────────────────────
// 최근 경기 기록 (최대 10경기) — 경기 준비 화면 아래에 보여 준다
// ─────────────────────────────────────────────

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function MatchHistory() {
  const history = useStore((s) => s.history);
  const clearHistory = useStore((s) => s.clearHistory);

  return (
    <section className="history" data-testid="history">
      <header className="history__head">
        <h3>📜 최근 경기 기록</h3>
        <span className="muted small">최근 {MAX_HISTORY}경기까지 저장돼요</span>
        {history.length > 0 && (
          <button className="btn btn--text history__clear" onClick={() => confirm('경기 기록을 모두 지울까요?') && clearHistory()}>
            기록 지우기
          </button>
        )}
      </header>

      {history.length === 0 ? (
        <p className="history__empty muted">아직 끝까지 마친 경기가 없어요. 첫 경기를 시작해 보세요!</p>
      ) : (
        <ol className="history__list">
          {history.map((r) => <HistoryItem key={r.id} record={r} />)}
        </ol>
      )}
    </section>
  );
}

function HistoryItem({ record: r }: { record: MatchRecord }) {
  const winner = r.score.home === r.score.away ? null : r.score.home > r.score.away ? 'home' : 'away';
  const accent = winner ? r[winner].color : 'var(--muted)';

  return (
    <li className="history__item" style={{ '--team': accent } as React.CSSProperties} data-testid="history-item">
      <details>
        <summary>
          <time className="history__date" dateTime={r.playedAt}>{dateFormat.format(new Date(r.playedAt))}</time>
          <TeamName team={r.home} win={winner === 'home'} />
          <span className="history__score">
            {r.score.home} : {r.score.away}
          </span>
          <TeamName team={r.away} win={winner === 'away'} align="right" />
          <span className="history__result">{recordResult(r)}</span>
        </summary>
        {r.scorers.length > 0 ? (
          <ul className="history__scorers">
            {r.scorers.map((g, i) => (
              <li key={i}>
                <b>{g.minute}'</b> ⚽ {g.name} <span className="muted">({r[g.side].name})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small history__scorers">골 없이 끝난 경기예요.</p>
        )}
      </details>
    </li>
  );
}

function TeamName({ team, win, align = 'left' }: { team: RecordTeam; win: boolean; align?: 'left' | 'right' }) {
  return (
    <span className={`history__team history__team--${align} ${win ? 'is-win' : ''}`}>
      {team.emoji} {team.name}
    </span>
  );
}
