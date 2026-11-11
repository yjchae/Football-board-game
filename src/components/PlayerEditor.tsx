import { useRef, useState } from 'react';
import { canScanCards, scanCard } from '../ai/engine';
import { guessRole } from '../ai/parse';
import type { Player, Role } from '../domain/types';
import { useStore } from '../store/useStore';
import { dataUrlToBase64, resizeImage } from '../utils/image';
import { STAT_LABELS } from './PlayerCard';

// ─────────────────────────────────────────────
// 선수 등록/수정 창
// 1) 카드 사진 찍기 → 2) AI가 카드 읽기 → 3) 확인 후 저장
// ─────────────────────────────────────────────

type Draft = Omit<Player, 'id'> & { id?: string };

const EMPTY: Draft = {
  name: '',
  number: 0,
  role: 'MF',
  position: 'CM',
  overall: 70,
  stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
};

const ROLES: { value: Role; label: string }[] = [
  { value: 'GK', label: '골키퍼' },
  { value: 'DF', label: '수비수' },
  { value: 'MF', label: '미드필더' },
  { value: 'FW', label: '공격수' },
];

interface Props {
  initial?: Player;
  onSave(player: Draft): void;
  onDelete?(): void;
  onClose(): void;
}

export function PlayerEditor({ initial, onSave, onDelete, onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY);
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const scanEnabled = canScanCards(settings);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchStat = (key: keyof Player['stats'], value: number) =>
    setDraft((d) => ({ ...d, stats: { ...d.stats, [key]: value } }));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      // 저장용 썸네일과 AI 판독용 큰 이미지를 따로 만든다
      const [thumb, big] = await Promise.all([resizeImage(file, 320, 0.8), resizeImage(file, 1280, 0.85)]);
      patch({ photo: thumb });
      setScanImage(big);
      if (scanEnabled) await runScan(big);
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : '사진 처리 실패' });
    }
  }

  async function runScan(image = scanImage) {
    if (!image) return;
    setStatus({ kind: 'busy', text: 'AI가 카드를 읽고 있어요…' });
    try {
      const card = await scanCard(settings, dataUrlToBase64(image));
      patch(card);
      setStatus({ kind: 'ok', text: '카드를 읽었어요! 틀린 곳이 있으면 고쳐 주세요.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : '카드 인식 실패' });
    }
  }

  const valid = draft.name.trim().length > 0;

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h3>{initial ? '선수 수정' : '새 선수 등록'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {/* ── 1. 카드 사진 */}
        <section className="scan">
          <button type="button" className="scan__photo" onClick={() => fileRef.current?.click()}>
            {draft.photo ? <img src={draft.photo} alt="카드 사진" /> : <span>📸<br />카드 사진 찍기</span>}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <div className="scan__info">
            <p>실물 카드를 밝은 곳에서 정면으로 찍어 주세요.</p>
            {scanEnabled ? (
              <button className="btn btn--ghost" disabled={!scanImage || status.kind === 'busy'} onClick={() => runScan()}>
                🤖 AI로 다시 읽기
              </button>
            ) : (
              <p className="muted small">AI 키를 설정하면 카드 정보를 자동으로 읽어요. 지금은 직접 입력해 주세요.</p>
            )}
            {status.text && <p className={`status status--${status.kind}`}>{status.text}</p>}
          </div>
        </section>

        {/* ── 2. 기본 정보 */}
        <div className="form-grid">
          <label className="field field--wide">
            <span>이름</span>
            <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="선수 이름" />
          </label>
          <label className="field">
            <span>등번호</span>
            <input type="number" min={0} max={99} value={draft.number} onChange={(e) => patch({ number: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>카드 포지션</span>
            <input
              value={draft.position}
              onChange={(e) => {
                const position = e.target.value.toUpperCase();
                patch({ position, role: guessRole(position) });
              }}
              placeholder="ST, CM, CB…"
            />
          </label>
          <div className="field field--wide">
            <span>역할</span>
            <div className="seg">
              {ROLES.map((r) => (
                <button key={r.value} type="button" className={draft.role === r.value ? 'on' : ''} onClick={() => patch({ role: r.value })}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field field--wide">
            <span>종합 능력치 <b>{draft.overall}</b></span>
            <input type="range" min={1} max={99} value={draft.overall} onChange={(e) => patch({ overall: Number(e.target.value) })} />
          </label>
        </div>

        {/* ── 3. 세부 능력치 */}
        <div className="stat-sliders">
          {STAT_LABELS.map(([key, label]) => (
            <label key={key} className="field">
              <span>{label} <b>{draft.stats[key]}</b></span>
              <input type="range" min={1} max={99} value={draft.stats[key]} onChange={(e) => patchStat(key, Number(e.target.value))} />
            </label>
          ))}
        </div>

        <footer className="modal__foot">
          {onDelete && (
            <button className="btn btn--danger" onClick={onDelete}>삭제</button>
          )}
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={onClose}>취소</button>
          <button className="btn btn--primary" disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
            저장
          </button>
        </footer>
      </div>
    </div>
  );
}
