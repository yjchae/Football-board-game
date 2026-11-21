import { useState } from 'react';
import { FORMATIONS, parseFormationId } from '../domain/formations';
import { useStore } from '../store/useStore';

// 포메이션 고르기: 프리셋 + 내가 만든 목록(지울 수 있음) + 직접 입력
// 팀 화면과 경기 중 작전 패널이 함께 쓴다.

/** "3-4-3", "3 4 3", "343" → 줄별 인원. 비어 있으면 [] */
const toRows = (raw: string) => (/^\d+$/.test(raw.trim()) ? raw.trim().split('') : raw.split(/[\s,.-]+/).filter(Boolean)).map(Number);

/** 입력이 규칙(3~5줄, 줄당 1~6명, 합 10)에 맞는지: 안 맞으면 이유 */
function check(raw: string): { id?: string; error?: string } {
  const rows = toRows(raw);
  if (rows.length === 0) return {};
  if (rows.length < 3 || rows.length > 5) return { error: `줄은 3~5개여야 해요(지금 ${rows.length}개)` };
  if (rows.some((n) => !(n >= 1 && n <= 6))) return { error: '한 줄에는 1~6명만 넣을 수 있어요' };
  const sum = rows.reduce((a, b) => a + b, 0);
  if (sum !== 10) return { error: `합이 10이어야 해요(지금 ${sum})` };
  const id = rows.join('-');
  return parseFormationId(id) ? { id } : { error: '이 모양은 쓸 수 없어요' };
}

export function FormationPicker({ value, onPick }: { value: string; onPick(id: string): void }) {
  const custom = useStore((s) => s.customFormations);
  const addCustomFormation = useStore((s) => s.addCustomFormation);
  const removeCustomFormation = useStore((s) => s.removeCustomFormation);
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const { id, error } = check(raw);
  const known = new Set([...FORMATIONS.map((f) => f.id), ...custom]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    addCustomFormation(id); // 이미 있는 모양이면 추가 없이 고르기만 한다
    onPick(id);
    setRaw('');
    setOpen(false);
  }

  return (
    <div className="formation-picker" data-testid="formation-picker">
      <div className="seg" role="group" aria-label="포메이션">
        {FORMATIONS.map((f) => (
          <button key={f.id} className={value === f.id ? 'on' : ''} aria-pressed={value === f.id} onClick={() => onPick(f.id)}>
            {f.name}
          </button>
        ))}
        {custom.map((c) => (
          <span key={c} style={{ display: 'contents' }}>
            <button className={value === c ? 'on' : ''} aria-pressed={value === c} onClick={() => onPick(c)}>{c}</button>
            <button className="fm-del" onClick={() => removeCustomFormation(c)} aria-label={`${c} 목록에서 지우기`}>✕</button>
          </span>
        ))}
        {/* 목록에서 지웠지만 팀이 아직 쓰고 있는 모양 */}
        {!known.has(value) && <button className="on" aria-pressed>{value}</button>}
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="formation-custom-toggle">＋직접 입력</button>
      </div>
      {open && (
        <form onSubmit={submit}>
          <input
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            inputMode="numeric"
            placeholder="예: 3-4-3"
            aria-label="포메이션 숫자 (수비-미드-공격)"
            aria-invalid={Boolean(error)}
            data-testid="formation-input"
          />
          <button className="btn btn--primary" disabled={!id} data-testid="formation-add">추가</button>
          <span className={`small ${error ? 'status status--error' : 'muted'}`} role="status" data-testid="formation-msg">
            {error ?? (id ? `${id} 모양이에요` : '수비-미드-공격 순서로 3~5줄, 합 10')}
          </span>
        </form>
      )}
      <p className="muted small">포메이션을 누르면 옮긴 위치는 기본 위치로 돌아가요</p>
    </div>
  );
}
