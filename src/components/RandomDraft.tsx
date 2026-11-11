import { useMemo, useState } from 'react';
import { LEAGUES, type LeagueId, type RealPlayer } from '../data/realPlayers';
import { draftRandomPlayers, toGamePlayers, type SquadSize } from '../domain/randomSquad';
import type { Role, Team } from '../domain/types';
import { useStore } from '../store/useStore';
import { tierOf } from './PlayerCard';

// ─────────────────────────────────────────────
// 실존 선수 랜덤 뽑기
// 1) 리그 고르기 (여러 개 가능) + 몇 명 뽑을지
// 2) 🎲 뽑기 → 결과 확인 (마음에 안 들면 다시 뽑기)
// 3) 팀에 추가 + 선발 자동 배치
// ─────────────────────────────────────────────

const SIZES: { value: SquadSize; label: string }[] = [
  { value: 1, label: '1명' },
  { value: 11, label: '선발 11명' },
  { value: 16, label: '후보 포함 16명' },
];

const ROLE_ORDER: Record<Role, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
const leagueOf = (id: LeagueId) => LEAGUES.find((l) => l.id === id)!;

export function RandomDraft({ team, onClose }: { team: Team; onClose(): void }) {
  const addPlayers = useStore((s) => s.addPlayers);
  const [leagues, setLeagues] = useState<LeagueId[]>(LEAGUES.map((l) => l.id));
  const [size, setSize] = useState<SquadSize>(11);
  const [drafted, setDrafted] = useState<RealPlayer[] | null>(null);
  const [autoPlace, setAutoPlace] = useState(true);

  const excludeNames = useMemo(() => team.players.map((p) => p.name), [team.players]);
  const sorted = useMemo(
    () => [...(drafted ?? [])].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.overall - a.overall),
    [drafted],
  );
  const fromOtherLeagues = sorted.filter((p) => !leagues.includes(p.league)).length;

  function toggleLeague(id: LeagueId) {
    setLeagues((cur) => (cur.includes(id) ? cur.filter((l) => l !== id) : [...cur, id]));
    setDrafted(null);
  }

  function chooseSize(value: SquadSize) {
    setSize(value);
    setAutoPlace(value !== 1);
    setDrafted(null);
  }

  function draw() {
    setDrafted(draftRandomPlayers({ leagues, size, excludeNames }));
  }

  function save() {
    const players = toGamePlayers(sorted, team.players.map((p) => p.number));
    addPlayers(team.id, players, autoPlace ? { kind: 'auto' } : { kind: 'none' });
    onClose();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel modal__panel--lg" onClick={(e) => e.stopPropagation()} data-testid="random-draft">
        <header className="modal__head">
          <h3>🎲 실존 선수 랜덤 뽑기</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="field">
          <span>리그 (여러 개 고를 수 있어요)</span>
          <div className="league-chips">
            {LEAGUES.map((l) => (
              <button
                key={l.id}
                className={`league-chip ${leagues.includes(l.id) ? 'on' : ''}`}
                aria-pressed={leagues.includes(l.id)}
                onClick={() => toggleLeague(l.id)}
              >
                <span>{l.flag}</span> {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>몇 명 뽑을까요?</span>
          <div className="seg" role="radiogroup" aria-label="뽑을 인원">
            {SIZES.map((s) => (
              <button key={s.value} className={size === s.value ? 'on' : ''} onClick={() => chooseSize(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn--primary btn--block draft-roll" disabled={leagues.length === 0} onClick={draw} data-testid="draft-roll">
          {drafted ? '🔄 다시 뽑기' : '🎲 뽑기!'}
        </button>
        {leagues.length === 0 && <p className="muted small center">리그를 하나 이상 골라 주세요.</p>}

        {drafted && (
          <>
            {drafted.length === 0 ? (
              <p className="muted center">더 뽑을 선수가 없어요. 이미 팀에 다 들어 있나 봐요!</p>
            ) : (
              <ul className="draft-list" data-testid="draft-list">
                {sorted.map((p) => (
                  <li key={p.name} className={`draft-card pcard--${tierOf(p.overall)}`}>
                    <div className="draft-card__ovr">
                      <strong>{p.overall}</strong>
                      <span>{p.position}</span>
                    </div>
                    <div className="draft-card__info">
                      <b>{p.name}</b>
                      <small>{leagueOf(p.league).flag} {p.club}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {fromOtherLeagues > 0 && (
              <p className="muted small">고른 리그에 포지션별 선수가 모자라서 {fromOtherLeagues}명은 다른 리그에서 데려왔어요.</p>
            )}
          </>
        )}

        <p className="muted small">
          ⚠️ 소속팀은 2025-26 시즌 무렵 기준이라 지금과 다를 수 있어요. 능력치는 게임용 추정치이고, 등번호는 비어 있는 번호로 자동으로 붙여요.
        </p>

        <footer className="modal__foot">
          {drafted && drafted.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={autoPlace} onChange={(e) => setAutoPlace(e.target.checked)} />
              선발 자동 배치
            </label>
          )}
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={onClose}>취소</button>
          <button className="btn btn--primary" disabled={!drafted || drafted.length === 0} onClick={save} data-testid="draft-save">
            {drafted?.length ?? 0}명 팀에 추가
          </button>
        </footer>
      </div>
    </div>
  );
}
