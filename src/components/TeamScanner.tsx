import { useRef, useState } from 'react';
import { canScanCards, scanTeamPhoto } from '../ai/engine';
import { guessRole } from '../ai/parse';
import { onPitchIds } from '../domain/formations';
import type { Player, Role, Team } from '../domain/types';
import { useStore } from '../store/useStore';
import { cropImage, dataUrlToBase64, resizeImage } from '../utils/image';
import { tierOf } from './PlayerCard';

// ─────────────────────────────────────────────
// 팀 한 번에 등록
// 1) 카드 여러 장을 펼쳐 놓고 찍은 사진 선택 (여러 장 가능)
// 2) AI가 사진 속 카드를 모두 찾아 선수 목록 생성 + 카드 부분만 잘라 사진으로 사용
// 3) 목록 확인·수정 → 한 번에 추가 (+ 자동 포지션 배치)
// ─────────────────────────────────────────────

interface Row {
  key: number;
  include: boolean;
  duplicate: boolean;
  player: Omit<Player, 'id'>;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'scanning'; done: number; total: number }
  | { kind: 'review' };

const ROLE_LABEL: Record<Role, string> = { GK: '골키퍼', DF: '수비', MF: '미드', FW: '공격' };
const normalize = (name: string) => name.replace(/\s+/g, '').toLowerCase();

export function TeamScanner({ team, onClose, onGoSettings }: { team: Team; onClose(): void; onGoSettings?(): void }) {
  const settings = useStore((s) => s.settings);
  const addPlayers = useStore((s) => s.addPlayers);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [arrange, setArrange] = useState(onPitchIds(team.lineup).length < 11);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const scanEnabled = canScanCards(settings);

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setErrors([]);
    setStep({ kind: 'scanning', done: 0, total: files.length });

    const existing = new Set(team.players.map((p) => normalize(p.name)));
    const found: Row[] = [];
    const problems: string[] = [];

    for (const [i, file] of files.entries()) {
      try {
        // 카드가 여러 장이라 글씨가 작다 → 큰 해상도로 판독
        const big = await resizeImage(file, 2048, 0.88);
        const cards = await scanTeamPhoto(settings, dataUrlToBase64(big));
        if (!cards.length) problems.push(`${i + 1}번째 사진: 카드를 찾지 못했어요.`);

        for (const { box, ...card } of cards) {
          const photo = box ? await cropImage(big, box).catch(() => undefined) : undefined;
          const key = normalize(card.name);
          const duplicate = existing.has(key) || found.some((r) => normalize(r.player.name) === key);
          found.push({ key: found.length, include: !duplicate, duplicate, player: { ...card, photo } });
        }
      } catch (err) {
        problems.push(`${i + 1}번째 사진: ${err instanceof Error ? err.message : '분석 실패'}`);
      }
      setStep({ kind: 'scanning', done: i + 1, total: files.length });
    }

    setRows((prev) => [...prev, ...found.map((r, i) => ({ ...r, key: prev.length + i }))]);
    setErrors(problems);
    setStep({ kind: 'review' });
  }

  const patchRow = (key: number, patch: Partial<Row['player']>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, player: { ...r.player, ...patch } } : r)));
  const toggleRow = (key: number) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, include: !r.include } : r)));
  const selected = rows.filter((r) => r.include && r.player.name.trim());
  const allOn = rows.length > 0 && rows.every((r) => r.include);

  function save() {
    addPlayers(team.id, selected.map((r) => ({ ...r.player, name: r.player.name.trim() })), arrange);
    onClose();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel modal__panel--lg" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h3>📸 팀 한 번에 등록</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        {/* 숨겨진 파일 입력: 카메라 / 앨범(여러 장) */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} data-testid="team-camera" />
        <input ref={albumRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} data-testid="team-album" />

        {!scanEnabled && (
          <div className="notice-box">
            팀 사진 인식은 AI가 카드를 읽어야 해서 <b>AI 키 연결</b>이 필요해요.
            {onGoSettings && <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={onGoSettings}>AI 설정으로 가기</button>}
          </div>
        )}

        {step.kind === 'pick' && scanEnabled && (
          <div className="bulk-pick">
            <div className="bulk-pick__tips">
              <b>잘 찍는 방법</b>
              <ul>
                <li>카드를 <b>겹치지 않게</b> 펼쳐 놓아요 (한 장에 11~15장 정도 추천)</li>
                <li>밝은 곳에서, 카드 글씨가 보이도록 <b>위에서 똑바로</b> 찍어요</li>
                <li>빛 반사가 생기면 각도를 살짝 바꿔요</li>
                <li>선수가 많으면 사진을 <b>여러 장</b>으로 나눠 찍어도 돼요</li>
              </ul>
            </div>
            <div className="bulk-pick__actions">
              <button className="btn btn--primary btn--xl" onClick={() => cameraRef.current?.click()}>📷 카메라로 찍기</button>
              <button className="btn btn--ghost" onClick={() => albumRef.current?.click()}>🖼️ 앨범에서 고르기 (여러 장 가능)</button>
            </div>
          </div>
        )}

        {step.kind === 'scanning' && (
          <div className="bulk-scanning">
            <div className="ball-spin bulk-scanning__ball">⚽</div>
            <b>AI가 카드를 찾고 있어요… ({step.done}/{step.total}장)</b>
            <p className="muted small">카드가 많으면 조금 오래 걸려요.</p>
          </div>
        )}

        {step.kind === 'review' && (
          <>
            {errors.map((e) => <p key={e} className="status status--error">{e}</p>)}
            <div className="bulk-head">
              <label className="check">
                <input type="checkbox" checked={allOn} onChange={() => setRows((rs) => rs.map((r) => ({ ...r, include: !allOn })))} />
                전체 선택
              </label>
              <span className="muted small">찾은 카드 {rows.length}장 · 추가할 선수 {selected.length}명</span>
              <span className="spacer" />
              <button className="btn btn--ghost" onClick={() => albumRef.current?.click()}>＋ 사진 더 추가</button>
            </div>

            {rows.length === 0 && <p className="muted center">찾은 카드가 없어요. 다시 찍어 볼까요?</p>}

            <ul className="bulk-list" data-testid="bulk-list">
              {rows.map((r) => (
                <li key={r.key} className={`bulk-row ${r.include ? '' : 'bulk-row--off'}`}>
                  <input type="checkbox" checked={r.include} onChange={() => toggleRow(r.key)} aria-label={`${r.player.name} 추가`} />
                  <div className={`bulk-row__thumb pcard--${tierOf(r.player.overall)}`}>
                    {r.player.photo ? <img src={r.player.photo} alt="" /> : <span>{r.player.overall}</span>}
                  </div>
                  <div className="bulk-row__fields">
                    <input className="bulk-row__name" value={r.player.name} onChange={(e) => patchRow(r.key, { name: e.target.value })} aria-label="이름" />
                    <div className="bulk-row__meta">
                      <label>#<input type="number" min={0} max={99} value={r.player.number} onChange={(e) => patchRow(r.key, { number: Number(e.target.value) })} aria-label="등번호" /></label>
                      <input
                        className="bulk-row__pos"
                        value={r.player.position}
                        onChange={(e) => {
                          const position = e.target.value.toUpperCase();
                          patchRow(r.key, { position, role: guessRole(position) });
                        }}
                        aria-label="포지션"
                      />
                      <select value={r.player.role} onChange={(e) => patchRow(r.key, { role: e.target.value as Role })} aria-label="역할">
                        {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                      </select>
                      <label>OVR<input type="number" min={1} max={99} value={r.player.overall} onChange={(e) => patchRow(r.key, { overall: Number(e.target.value) })} aria-label="종합 능력치" /></label>
                    </div>
                    {r.duplicate && <span className="bulk-row__dup">이미 등록된 이름이에요</span>}
                  </div>
                </li>
              ))}
            </ul>

            <footer className="modal__foot">
              <label className="check">
                <input type="checkbox" checked={arrange} onChange={(e) => setArrange(e.target.checked)} />
                추가 후 포지션 자동 배치
              </label>
              <span className="spacer" />
              <button className="btn btn--ghost" onClick={onClose}>취소</button>
              <button className="btn btn--primary" disabled={selected.length === 0} onClick={save} data-testid="bulk-save">
                {selected.length}명 추가하기
              </button>
            </footer>
            <p className="muted small">세부 능력치(속도·슈팅 등)는 추가한 뒤 선수 카드를 눌러 고칠 수 있어요.</p>
          </>
        )}
      </div>
    </div>
  );
}
