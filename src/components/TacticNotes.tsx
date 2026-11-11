import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { MatchSide } from '../domain/match';
import {
  analyzeTactic,
  TACTIC_CHIPS,
  TACTIC_INFO,
  TACTIC_MAX,
  tacticLabel,
  tacticStatus,
  winningMatchups,
  type Half,
  type TacticChip,
  type TacticKey,
  type TacticNote,
  type TacticStatus,
} from '../domain/tactics';
import type { Side, SideStats, Team } from '../domain/types';

// ─────────────────────────────────────────────
// 감독 전술 노트 화면 (설계: docs/07-UI설계자-전술화면-설계서.md)
//   TacticsBoard      경기 전·하프타임: 두 팀 카드 + 작성 시트
//   TacticCard        팀 카드 1장 (전술 내용은 절대 보여 주지 않는다)
//   TacticEditorSheet 가림막 → 작성 창 (포털, 포커스 트랩, ESC)
//   TacticReveal      경기 종료: 양 팀 전술 공개
// ─────────────────────────────────────────────

type Sides = { home: MatchSide; away: MatchSide };

const SIDES: Side[] = ['home', 'away'];
const SIDE_TAG: Record<Side, string> = { home: 'HOME', away: 'AWAY' };
const SIDE_KO: Record<Side, string> = { home: '홈', away: '원정' };
const HALF_KO: Record<Half, string> = { 1: '전반', 2: '후반' };

const teamStyle = (team: Team) => ({ '--team': team.color }) as CSSProperties;

// ─────────────── 카드 문구 (상태별) ───────────────

interface CardCopy {
  badge: string;
  sub: string;
  cta: string;
  /** 스크린리더용 "무엇을 하는 버튼인지" */
  action: string;
}

function cardCopy(status: TacticStatus, half: Half): CardCopy {
  switch (status) {
    case 'empty':
      return {
        badge: '✏️ 아직 작전이 없어요',
        sub: half === 1 ? '눌러서 우리 팀 작전을 적어요' : '후반 작전을 적어 볼까요?',
        cta: '작전 쓰기 →',
        action: '작전 쓰기',
      };
    case 'saved':
      return { badge: '🔒 전술 저장됨', sub: '내용은 비밀이에요', cta: '고치기 →', action: '작전 고치기' };
    case 'kept':
      return { badge: '↩️ 전반 전술 유지', sub: '그대로 두면 전반 작전으로 뛰어요', cta: '후반 작전 쓰기 →', action: '후반 작전 쓰기' };
    case 'resaved':
      return { badge: '🔒 후반 전술 저장됨', sub: '내용은 비밀이에요', cta: '고치기 →', action: '작전 고치기' };
  }
}

// ─────────────── 킥오프 / 후반 시작 확인 ───────────────

/**
 * 전술을 안 쓴 팀이 있으면 확인창을 띄운다. 진행해도 되면 true.
 * 취소하면 첫 번째 미작성 팀 카드로 포커스를 옮긴다.
 */
export function confirmMissingTactics(sides: Sides, tactics: Record<Side, TacticNote>, half: Half): boolean {
  const missing = SIDES.filter((s) => tacticStatus(tactics[s], half) === 'empty');
  if (!missing.length) return true;

  const who = missing.length === 2 ? '두 팀 모두' : `${sides[missing[0]].team.emoji} ${sides[missing[0]].team.name} 감독님이`;
  const message =
    half === 1
      ? `${who} 아직 전술을 안 썼어요.\n기본 '⚖️ 균형' 전술로 시작할까요?`
      : `${who} 후반 작전이 없어요.\n기본 '⚖️ 균형' 전술로 후반을 시작할까요?`;
  if (window.confirm(message)) return true;

  const card = document.querySelector<HTMLElement>(`[data-testid="tactic-card-${missing[0]}"]`);
  card?.scrollIntoView({ block: 'center' });
  card?.focus();
  return false;
}

// ─────────────── 보드: 두 팀 카드 + 작성 시트 ───────────────

interface TacticsBoardProps {
  sides: Sides;
  tactics: Record<Side, TacticNote>;
  /** 1 = 경기 전, 2 = 하프타임 */
  half: Half;
  onSave(side: Side, half: Half, text: string): void;
  /** 하프타임 작성 창에 보여 줄 전반 기록 (자기 팀 수치만) */
  firstHalfStats?: Record<Side, SideStats>;
}

export function TacticsBoard({ sides, tactics, half, onSave, firstHalfStats }: TacticsBoardProps) {
  const [editing, setEditing] = useState<Side | null>(null);
  const [justSaved, setJustSaved] = useState<Side | null>(null);
  const [live, setLive] = useState('');
  const cards = useRef<Record<Side, HTMLButtonElement | null>>({ home: null, away: null });

  const statuses = { home: tacticStatus(tactics.home, half), away: tacticStatus(tactics.away, half) };
  const readyCount = SIDES.filter((s) => statuses[s] !== 'empty').length;

  const close = (side: Side) => {
    setEditing(null);
    // 시트를 연 카드로 포커스를 돌려 놓는다 (포털이 사라진 다음 프레임)
    requestAnimationFrame(() => cards.current[side]?.focus());
  };

  const save = (side: Side, text: string) => {
    onSave(side, half, text);
    setJustSaved(side);
    setLive(`${sides[side].team.name} 전술이 ${text.trim() ? '저장됐어요' : '지워졌어요'}`);
    close(side);
  };

  const note = editing ? tactics[editing] : undefined;
  const initialText = note ? ((half === 1 ? note.first : (note.second ?? note.first)) ?? '') : '';

  return (
    <section className="tboard" aria-labelledby="tboard-title" data-testid="tactic-board" data-half={half}>
      <h3 id="tboard-title" className="stage__title">📝 {half === 1 ? '감독 전술 노트' : '후반 전술 노트'}</h3>
      <p className="tboard__hint muted small">각 팀 감독이 자기 팀 카드를 눌러 몰래 작전을 적어요.</p>

      <div className="tboard__grid">
        {SIDES.map((side) => (
          <TacticCard
            key={side}
            ref={(el) => {
              cards.current[side] = el;
            }}
            side={side}
            team={sides[side].team}
            half={half}
            status={statuses[side]}
            expanded={editing === side}
            justSaved={justSaved === side}
            onOpen={() => setEditing(side)}
          />
        ))}
      </div>

      <p className={`tboard__progress ${readyCount === 2 ? 'tboard__progress--done' : ''}`} data-testid="tactic-progress">
        {readyCount === 2 ? '✅' : '✏️'} {readyCount} / 2 팀 준비 완료
      </p>
      <p className="sr-only" aria-live="polite" data-testid="tactic-live">{live}</p>

      {editing && (
        <TacticEditorSheet
          key={editing}
          side={editing}
          team={sides[editing].team}
          half={half}
          initialText={initialText}
          needsGuard={statuses[editing] !== 'empty'}
          prefilledFromFirst={half === 2 && note?.second === undefined && Boolean(note?.first)}
          firstText={note?.first ?? ''}
          halfStats={half === 2 ? firstHalfStats?.[editing] : undefined}
          onSave={(text) => save(editing, text)}
          onClose={() => close(editing)}
        />
      )}
    </section>
  );
}

// ─────────────── 팀 카드 ───────────────

interface TacticCardProps {
  ref?: Ref<HTMLButtonElement>;
  side: Side;
  team: Team;
  half: Half;
  status: TacticStatus;
  expanded: boolean;
  justSaved: boolean;
  onOpen(): void;
}

/** 카드 전체가 버튼. 저장된 전술의 내용(글자·글자 수·인식 칩)은 절대 넣지 않는다 */
export function TacticCard({ ref, side, team, half, status, expanded, justSaved, onOpen }: TacticCardProps) {
  const copy = cardCopy(status, half);
  const halfTag = status === 'kept' ? '1ST' : status === 'resaved' ? '2ND' : null;
  return (
    <button
      ref={ref}
      type="button"
      className={`tcard tcard--${status} ${justSaved ? 'tcard--just-saved' : ''}`}
      style={teamStyle(team)}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={`${team.name} ${SIDE_KO[side]} 팀 ${copy.action}, ${copy.badge.replace(/^\S+\s/, '')}`}
      data-testid={`tactic-card-${side}`}
      data-status={status}
    >
      <span className="tcard__side">{SIDE_TAG[side]}</span>
      <span className="tcard__team">
        <span className="tcard__emoji">{team.emoji}</span>
        <span className="tcard__name">{team.name}</span>
      </span>
      <span className="tcard__state" data-testid={`tactic-card-state-${side}`}>
        {copy.badge}
        {halfTag && <span className="tcard__half">{halfTag}</span>}
      </span>
      <span className="tcard__sub">{copy.sub}</span>
      <span className="tcard__cta">{copy.cta}</span>
    </button>
  );
}

// ─────────────── 작성 시트 ───────────────

interface TacticEditorSheetProps {
  side: Side;
  team: Team;
  half: Half;
  initialText: string;
  /** 저장된 작전이 있으면 가림막부터 (상대 감독이 못 보게) */
  needsGuard: boolean;
  /** 하프타임에 전반 작전을 불러왔는지 (안내문 표시) */
  prefilledFromFirst: boolean;
  /** 전반 작전 원문 ("그대로 저장" 판단용) */
  firstText: string;
  halfStats?: SideStats;
  onSave(text: string): void;
  onClose(): void;
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [href], [tabindex]:not([tabindex="-1"])';

/** 칩 문장을 글 끝에 덧붙인다 (앞에 공백 1칸) */
const appendSentence = (text: string, sentence: string) => (!text.trim() ? sentence : `${text.replace(/\s+$/, '')} ${sentence}`);

export function TacticEditorSheet(props: TacticEditorSheetProps) {
  const { side, team, half, initialText, needsGuard, prefilledFromFirst, firstText, halfStats, onSave, onClose } = props;
  const [stage, setStage] = useState<'guard' | 'edit'>(needsGuard ? 'guard' : 'edit');
  const [text, setText] = useState(initialText);
  const [denied, setDenied] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // 시트가 떠 있는 동안 뒤 화면은 키보드·스크린리더에서 빠진다
  // (layout effect: 닫힐 때 inert가 즉시 풀려야 카드로 포커스를 돌려 놓을 수 있다)
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, []);

  // 단계가 바뀌면 포커스 이동: 가림막 → "열기" 버튼, 작성 → 글 끝
  useEffect(() => {
    if (stage === 'guard') {
      openRef.current?.focus();
      return;
    }
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [stage]);

  useEffect(() => {
    if (!denied) return;
    const timer = setTimeout(() => setDenied(null), 1200);
    return () => clearTimeout(timer);
  }, [denied]);

  const dirty = stage === 'edit' && text !== initialText;
  const requestClose = () => {
    if (dirty && !window.confirm('적던 작전이 사라져요. 닫을까요?')) return;
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    // 포커스 트랩: 시트 안에서만 돈다
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const addChip = (chip: TacticChip) => {
    if (text.includes(chip.sentence)) return; // 같은 칩은 한 번만
    const next = appendSentence(text, chip.sentence);
    if (next.length > TACTIC_MAX) {
      setDenied(chip.id);
      return;
    }
    setText(next);
    const el = textRef.current;
    if (el) requestAnimationFrame(() => el.setSelectionRange(next.length, next.length));
  };

  const trimmed = text.trim();
  const saveLabel = !trimmed
    ? '🗑️ 작전 지우기'
    : half === 1
      ? '💾 저장'
      : trimmed === firstText.trim()
        ? '💾 그대로 저장'
        : '💾 후반 작전 저장';
  const canSave = Boolean(trimmed) || Boolean(initialText.trim());
  const full = text.length >= TACTIC_MAX;

  return createPortal(
    <div className="modal tsheet-backdrop" onClick={requestClose}>
      <div
        ref={panelRef}
        className="tsheet"
        style={teamStyle(team)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tsheet-title"
        aria-describedby="tsheet-secret"
        data-testid="tactic-sheet"
        data-side={side}
        data-half={half}
        data-stage={stage}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="tsheet__grab" aria-hidden="true" />
        <header className="tsheet__head">
          <span className="tsheet__emoji" aria-hidden="true">{team.emoji}</span>
          <div className="tsheet__titles">
            <h3 id="tsheet-title" className="tsheet__title">{team.name} 감독님의 작전</h3>
            <div className="tsheet__meta">{SIDE_TAG[side]} · {HALF_KO[half]} 전술</div>
          </div>
          <button type="button" className="icon-btn tsheet__close" aria-label="닫기" onClick={requestClose} data-testid="tactic-close">✕</button>
        </header>

        <div className="tsheet__body">
          <p id="tsheet-secret" className="status status--warn tsheet__secret">
            🤫 {team.name} 감독만 보세요! 상대 감독은 잠깐 뒤돌아 주세요.
          </p>

          {stage === 'guard' ? (
            // 가림막 단계에서는 textarea를 아예 그리지 않는다 (DOM에도 전술 내용 없음)
            <div className="tsheet__guard">
              <div className="tsheet__guard-icon" aria-hidden="true">🙈</div>
              <h4>{team.name} 감독님만 열어 주세요!</h4>
              <p className="muted">상대 감독은 잠깐 화면을 보지 마세요.</p>
              <div className="tsheet__foot">
                <button type="button" className="btn btn--ghost" onClick={onClose} data-testid="tactic-guard-cancel">취소</button>
                <button type="button" ref={openRef} className="btn btn--primary" onClick={() => setStage('edit')} data-testid="tactic-guard-open">
                  👀 내가 감독이에요, 열기
                </button>
              </div>
            </div>
          ) : (
            <>
              {halfStats && (
                <p className="tsheet__stats small">📊 전반 결과: 슈팅 {halfStats.shots} · 골 {halfStats.goals}</p>
              )}
              {prefilledFromFirst && (
                <p className="tsheet__prefill muted small" data-testid="tactic-prefill-note">
                  전반 작전을 불러왔어요. 고쳐서 저장하거나 그대로 저장해도 돼요.
                </p>
              )}

              <span className="tsheet__label">빠르게 고르기</span>
              <div className="tsheet__chips" role="group" aria-label="빠르게 고르기">
                {TACTIC_CHIPS.map((chip) => {
                  const used = text.includes(chip.sentence);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      className={`tchip ${used ? 'tchip--used' : ''} ${denied === chip.id ? 'tchip--deny' : ''}`}
                      aria-label={`${TACTIC_INFO[chip.key].label} 덧붙이기`}
                      disabled={full && !used}
                      onClick={() => addChip(chip)}
                      data-testid={`tactic-chip-${chip.id}`}
                    >
                      {tacticLabel(chip.key)}
                    </button>
                  );
                })}
              </div>

              <label className="tsheet__label" htmlFor="tactic-text">작전 메모</label>
              <textarea
                id="tactic-text"
                ref={textRef}
                className="tsheet__textarea"
                value={text}
                maxLength={TACTIC_MAX}
                rows={5}
                placeholder='예: "초반엔 수비적으로, 기회가 오면 역습!"'
                aria-describedby="tactic-count tactic-preview"
                onChange={(e) => setText(e.target.value.slice(0, TACTIC_MAX))}
                data-testid="tactic-textarea"
              />
              <div className="tsheet__under">
                <span className="muted small">{denied || full ? '글자 수가 꽉 찼어요. 더 넣을 자리가 없어요' : ''}</span>
                <span id="tactic-count" className={`tsheet__count ${full ? 'tsheet__count--full' : text.length >= 180 ? 'tsheet__count--near' : ''}`}>
                  <span aria-hidden="true" data-testid="tactic-count">{text.length} / {TACTIC_MAX}</span>
                  <span className="sr-only" aria-live="polite">{text.length >= 180 ? `남은 글자 ${TACTIC_MAX - text.length}자` : ''}</span>
                </span>
              </div>

              <TacticPreview text={text} />

              <div className="tsheet__foot">
                <button type="button" className="btn btn--ghost" onClick={requestClose} data-testid="tactic-cancel">취소</button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!canSave}
                  title={canSave ? undefined : '한 글자 이상 적어 주세요'}
                  onClick={() => onSave(trimmed)}
                  data-testid="tactic-save"
                >
                  {saveLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "컴퓨터가 알아들은 전술" 실시간 미리보기 (오프라인 엔진과 같은 해석) */
function TacticPreview({ text }: { text: string }) {
  const parsed = analyzeTactic(text);
  let body: string;
  if (parsed.keys.length) body = keyList(parsed.keys, parsed.boosted);
  else if (parsed.conflictCancelled) body = "⚖️ 서로 반대인 전술이 같은 힘이라 '균형'으로 볼게요";
  else if (text.trim()) body = '특별한 전술은 못 찾았어요 → ⚖️ 균형';
  else body = '⚖️ 균형';
  return (
    <p id="tactic-preview" className="tsheet__preview" data-testid="tactic-preview">
      🤖 컴퓨터가 알아들은 전술: <b>{body}</b>
    </p>
  );
}

const keyList = (keys: TacticKey[], boosted: TacticKey[] = []) =>
  keys.map((k) => `${tacticLabel(k)}${boosted.includes(k) ? '(강조)' : ''}`).join(' · ');

// ─────────────── 경기 종료: 전술 공개 ───────────────

interface TacticRevealProps {
  sides: Sides;
  tactics: Record<Side, TacticNote>;
}

/** 하프별로 실제 적용된 전술 원문 */
const appliedText = (note: TacticNote, half: Half) => (half === 1 ? note.first : (note.second ?? note.first)) ?? '';

export function TacticReveal({ sides, tactics }: TacticRevealProps) {
  // 상성이 걸린 하프를 한 줄씩 설명한다 (엔진과 무관하게 인식 결과로 계산, 전·후반 같으면 한 줄로)
  const edges = new Map<string, Half[]>();
  for (const half of [1, 2] as Half[]) {
    const keys = { home: analyzeTactic(appliedText(tactics.home, half)).keys, away: analyzeTactic(appliedText(tactics.away, half)).keys };
    for (const s of SIDES) {
      const o: Side = s === 'home' ? 'away' : 'home';
      for (const m of winningMatchups(keys[s], keys[o])) {
        const line = `${sides[s].team.name}의 ${tacticLabel(m.winner)} → ${sides[o].team.name}의 ${tacticLabel(m.loser)} · ${m.text}`;
        edges.set(line, [...(edges.get(line) ?? []), half]);
      }
    }
  }

  return (
    <section className="treveal" aria-labelledby="treveal-title" data-testid="tactic-reveal">
      <h3 id="treveal-title" className="stage__title">🗒️ 감독 전술 공개!</h3>
      <div className="treveal__grid">
        {SIDES.map((side) => (
          <article key={side} className="treveal__card" style={teamStyle(sides[side].team)} data-testid={`tactic-reveal-${side}`}>
            <div className="treveal__team">
              <span aria-hidden="true">{sides[side].team.emoji}</span> {sides[side].team.name}
            </div>
            <dl className="treveal__list">
              <RevealHalf side={side} half={1} note={tactics[side]} />
              <RevealHalf side={side} half={2} note={tactics[side]} />
            </dl>
          </article>
        ))}
      </div>
      {[...edges].map(([line, halves]) => (
        <p key={line} className="treveal__edge">
          ⚡ {halves.length === 2 ? '전·후반' : HALF_KO[halves[0]]} 상성 성공! {line}
        </p>
      ))}
    </section>
  );
}

function RevealHalf({ side, half, note }: { side: Side; half: Half; note: TacticNote }) {
  const kept = half === 2 && note.second === undefined && Boolean(note.first);
  const text = half === 1 ? (note.first ?? '') : (note.second ?? '');
  const parsed = analyzeTactic(text);
  return (
    <>
      <dt className="treveal__half">{half === 1 ? '1ST' : '2ND'}</dt>
      <dd className="treveal__body" data-testid={`tactic-reveal-${side}-${half}`} data-kept={kept || undefined}>
        {kept ? (
          <p className="treveal__text treveal__text--kept">전반 전술 유지 (전반과 같음)</p>
        ) : text ? (
          <>
            <p className="treveal__text">“{text}”</p>
            <p className="treveal__keys small">{parsed.keys.length ? keyList(parsed.keys, parsed.boosted) : '⚖️ 균형'}</p>
          </>
        ) : (
          <p className="treveal__text treveal__text--none">📭 작전 없이 경기했어요 · ⚖️ 균형</p>
        )}
      </dd>
    </>
  );
}
