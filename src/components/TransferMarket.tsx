import { useMemo, useState } from 'react';
import { LEAGUES, type LeagueId, type RealPlayer } from '../data/realPlayers';
import { searchMarket } from '../domain/market';
import { toGamePlayers } from '../domain/randomSquad';
import type { Player, Role, Team } from '../domain/types';
import { useStore } from '../store/useStore';
import { tierOf } from './PlayerCard';

// ─────────────────────────────────────────────
// 이적시장: 1) 내보낼 내 선수 2) 데려올 선수 3) 확인 → 교환
// 인원은 그대로, 들어온 선수가 나간 선수의 자리·등번호를 물려받는다.
// ponytail: 선수 데이터는 랜덤 뽑기와 같은 묶음에 들어 있어 따로 늦게 불러오지 않는다.
// ─────────────────────────────────────────────

const ROLE_FILTERS: { value: Role | undefined; label: string }[] = [
  { value: undefined, label: '전체' },
  { value: 'GK', label: 'GK' },
  { value: 'DF', label: 'DF' },
  { value: 'MF', label: 'MF' },
  { value: 'FW', label: 'FW' },
];
const PAGE = 30;
const leagueOf = (id: LeagueId) => LEAGUES.find((l) => l.id === id)!;

export function TransferMarket({ team, onClose }: { team: Team; onClose(): void }) {
  const swapPlayer = useStore((s) => s.swapPlayer);
  const [out, setOut] = useState<Player | null>(null);
  const [incoming, setIncoming] = useState<RealPlayer | null>(null);
  const [filter, setFilter] = useState<{ query: string; leagues: LeagueId[]; role?: Role; pages: number }>({ query: '', leagues: [], pages: 1 });
  const patch = (p: Partial<typeof filter>) => setFilter((f) => ({ ...f, pages: 1, ...p }));

  const excludeNames = useMemo(() => team.players.map((p) => p.name), [team.players]);
  const { players, total } = useMemo(
    () => searchMarket({ leagues: filter.leagues, role: filter.role, query: filter.query, excludeNames, limit: filter.pages * PAGE }),
    [filter, excludeNames],
  );

  function confirm() {
    if (!out || !incoming) return;
    swapPlayer(team.id, out.id, toGamePlayers([incoming])[0]);
    onClose();
  }

  const step = !out ? 1 : !incoming ? 2 : 3;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="이적시장" onClick={onClose}>
      <div className="modal__panel modal__panel--lg" onClick={(e) => e.stopPropagation()} data-testid="transfer-market">
        <header className="modal__head">
          <h3>🔁 이적시장</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {step === 1 && (
          <>
            <p className="muted small">1단계 · 내보낼 선수를 골라요</p>
            <ul className="market-list" data-testid="market-mine">
              {team.players.map((p) => (
                <li key={p.id}>
                  <button className="market-row" onClick={() => setOut(p)} aria-label={`${p.name} 내보내기 (${p.position}, OVR ${p.overall})`}>
                    <b>{p.overall}</b>
                    <span className="market-row__info">
                      <b>{p.name}</b>
                      <small>{p.position}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 2 && out && (
          <>
            <p className="muted small">
              2단계 · <b>{out.name}</b>(OVR {out.overall}) 대신 데려올 선수를 골라요{' '}
              <button className="btn btn--text btn--inline" onClick={() => setOut(null)}>← 다른 선수 고르기</button>
            </p>
            <label className="field">
              <span>이름 검색</span>
              <input value={filter.query} onChange={(e) => patch({ query: e.target.value })} placeholder="예: 손흥민" data-testid="market-search" />
            </label>
            <div className="field">
              <span>리그 (비우면 전체)</span>
              <div className="league-chips">
                {LEAGUES.map((l) => {
                  const on = filter.leagues.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      className={`league-chip ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => patch({ leagues: on ? filter.leagues.filter((x) => x !== l.id) : [...filter.leagues, l.id] })}
                    >
                      <span>{l.flag}</span> {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <span>포지션</span>
              <div className="seg" role="radiogroup" aria-label="포지션 필터">
                {ROLE_FILTERS.map((r) => (
                  <button key={r.label} className={filter.role === r.value ? 'on' : ''} aria-pressed={filter.role === r.value} onClick={() => patch({ role: r.value })}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <ul className="market-list" data-testid="market-list">
              {players.map((p) => {
                const diff = p.overall - out.overall;
                return (
                  <li key={p.name}>
                    <button className={`market-row pcard--${tierOf(p.overall)}`} style={{ color: '#1b1607' }} onClick={() => setIncoming(p)} aria-label={`${p.name} 데려오기 (${p.position}, OVR ${p.overall})`}>
                      <b>{p.overall}</b>
                      <span className="market-row__info">
                        <b>{p.name}</b>
                        <small style={{ color: 'inherit', opacity: 0.75 }}>{p.position} · {leagueOf(p.league).flag} {p.club}</small>
                      </span>
                      <b className={diff >= 0 ? 'market-diff--up' : 'market-diff--down'} style={{ filter: 'brightness(0.6)' }}>{diff >= 0 ? `+${diff}` : diff}</b>
                    </button>
                  </li>
                );
              })}
            </ul>
            {players.length === 0 && <p className="muted center">조건에 맞는 선수가 없어요.</p>}
            {total > players.length && (
              <button className="btn btn--ghost btn--block" onClick={() => setFilter((f) => ({ ...f, pages: f.pages + 1 }))} data-testid="market-more">
                더 보기 ({players.length}/{total})
              </button>
            )}
          </>
        )}

        {step === 3 && out && incoming && (
          <div data-testid="market-confirm">
            <p>
              <b>{out.name}</b>(OVR {out.overall})를 내보내고 <b>{incoming.name}</b>(OVR {incoming.overall})을 데려와요.
            </p>
            <p className="muted small">내보낸 선수는 돌아오지 않을 수 있어요. 자리와 등번호는 새 선수가 이어받아요.</p>
            <footer className="modal__foot">
              <span className="spacer" />
              <button className="btn btn--ghost" onClick={() => setIncoming(null)}>돌아가기</button>
              <button className="btn btn--primary" onClick={confirm} data-testid="market-swap-confirm">교환하기</button>
            </footer>
          </div>
        )}

        <p className="muted small">
          ⚠️ 소속팀은 2025-26 시즌 무렵 기준이라 지금과 다를 수 있어요. 능력치는 게임용 추정치이고, 이름이 같은 선수는 데려올 수 없어요.
        </p>
      </div>
    </div>
  );
}
