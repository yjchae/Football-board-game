import { useState } from 'react';
import { LineupBoard } from '../components/LineupBoard';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerEditor } from '../components/PlayerEditor';
import { TeamScanner } from '../components/TeamScanner';
import { FORMATIONS, onPitchIds } from '../domain/formations';
import { applyDrop } from '../domain/lineupOps';
import type { Player, Team } from '../domain/types';
import { TEAM_COLORS, TEAM_EMOJIS, useStore } from '../store/useStore';

// ─────────────────────────────────────────────
// 팀 관리 화면: 팀 목록 / 선수 명단 / 포지션 배치
// ─────────────────────────────────────────────

export function TeamsScreen() {
  const teams = useStore((s) => s.teams);
  const loadDemo = useStore((s) => s.loadDemo);
  const [selectedId, setSelectedId] = useState<string | null>(teams[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const selected = teams.find((t) => t.id === selectedId) ?? teams[0];

  return (
    <div className="teams">
      <aside className="team-list">
        <h2 className="section-title">내 팀</h2>
        {teams.map((t) => (
          <button
            key={t.id}
            className={`team-pill ${selected?.id === t.id ? 'on' : ''}`}
            style={{ '--team': t.color } as React.CSSProperties}
            onClick={() => setSelectedId(t.id)}
          >
            <span className="team-pill__emoji">{t.emoji}</span>
            <span className="team-pill__name">{t.name}</span>
            <span className="team-pill__count">{t.players.length}명</span>
          </button>
        ))}
        <button className="btn btn--primary btn--block" onClick={() => setCreating(true)}>＋ 새 팀 만들기</button>
        {teams.length === 0 && (
          <button className="btn btn--ghost btn--block" onClick={loadDemo}>🎮 연습용 팀 2개 불러오기</button>
        )}
      </aside>

      <section className="team-detail">
        {selected ? (
          <TeamDetail key={selected.id} team={selected} />
        ) : (
          <div className="empty">
            <div className="empty__ball">⚽</div>
            <h3>아직 팀이 없어요</h3>
            <p>새 팀을 만들고 축구 카드를 찍어서 선수를 등록해 보세요!</p>
          </div>
        )}
      </section>

      {creating && (
        <TeamForm
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function TeamForm({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const addTeam = useStore((s) => s.addTeam);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(TEAM_EMOJIS[0]);
  const [color, setColor] = useState(TEAM_COLORS[0]);

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel modal__panel--sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h3>새 팀 만들기</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <label className="field">
          <span>팀 이름</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 우리반 FC" maxLength={20} />
        </label>
        <div className="field">
          <span>엠블럼</span>
          <div className="picker">
            {TEAM_EMOJIS.map((e) => (
              <button key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>팀 색상</span>
          <div className="picker">
            {TEAM_COLORS.map((c) => (
              <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
        <footer className="modal__foot">
          <span className="spacer" />
          <button className="btn btn--primary" disabled={!name.trim()} onClick={() => onCreated(addTeam(name.trim(), emoji, color))}>
            만들기
          </button>
        </footer>
      </div>
    </div>
  );
}

function TeamDetail({ team }: { team: Team }) {
  const { addPlayer, updatePlayer, removePlayer, removeTeam, updateTeam, setLineup, setFormation, autoArrange } = useStore();
  const [tab, setTab] = useState<'roster' | 'lineup'>('roster');
  const [editing, setEditing] = useState<Player | 'new' | null>(null);
  const [bulkScan, setBulkScan] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const starters = onPitchIds(team.lineup).length;

  return (
    <>
      <header className="team-head" style={{ '--team': team.color } as React.CSSProperties}>
        <span className="team-head__emoji">{team.emoji}</span>
        <input className="team-head__name" value={team.name} onChange={(e) => updateTeam(team.id, { name: e.target.value })} aria-label="팀 이름" />
        <span className="badge">선발 {starters}/11 · 전체 {team.players.length}명</span>
        <button
          className="icon-btn"
          title="팀 삭제"
          onClick={() => confirm(`"${team.name}" 팀을 삭제할까요?`) && removeTeam(team.id)}
        >
          🗑️
        </button>
      </header>

      <div className="tabs">
        <button className={tab === 'roster' ? 'on' : ''} onClick={() => setTab('roster')}>🃏 선수 명단</button>
        <button className={tab === 'lineup' ? 'on' : ''} onClick={() => setTab('lineup')}>📋 포지션 배치</button>
      </div>

      {tab === 'roster' ? (
        <div className="roster">
          <button className="add-card" onClick={() => setEditing('new')}>
            <span>＋</span>
            카드 1장 찍어서<br />선수 등록
          </button>
          <button className="add-card add-card--team" onClick={() => setBulkScan(true)}>
            <span>🃏🃏🃏</span>
            여러 장 한 번에 찍어서<br />팀 등록
          </button>
          {team.players.map((p) => (
            <PlayerCard key={p.id} player={p} onClick={() => setEditing(p)} />
          ))}
        </div>
      ) : (
        <div className="lineup-tab">
          <div className="toolbar">
            <div className="seg">
              {FORMATIONS.map((f) => (
                <button key={f.id} className={team.lineup.formationId === f.id ? 'on' : ''} onClick={() => setFormation(team.id, f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
            <button className="btn btn--ghost" onClick={() => autoArrange(team.id)}>✨ 자동 배치</button>
          </div>
          {message && <p className="status status--error">{message}</p>}
          <LineupBoard
            players={team.players}
            lineup={team.lineup}
            color={team.color}
            onDrop={(pid, target) => {
              const result = applyDrop(team.lineup, pid, target);
              setMessage(result.error ?? null);
              setLineup(team.id, result.lineup);
            }}
          />
        </div>
      )}

      {bulkScan && <TeamScanner team={team} onClose={() => setBulkScan(false)} />}

      {editing && (
        <PlayerEditor
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => { removePlayer(team.id, editing.id); setEditing(null); }}
          onSave={(draft) => {
            if (draft.id) updatePlayer(team.id, draft as Player);
            else addPlayer(team.id, draft);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
