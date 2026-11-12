import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fitMultiplier } from '../domain/match';
import type { DropTarget } from '../domain/lineupOps';
import { resolveSlots, shapeName } from '../domain/positions';
import type { Lineup, Player, Point } from '../domain/types';
import { PlayerAvatar } from './PlayerCard';

// ─────────────────────────────────────────────
// 포지션 보드: 드래그앤드롭 + 탭 두 번(선택→목적지)으로 선수 이동
// - 다른 선수 위에 놓기: 자리 바꾸기 / 교체
// - 빈 잔디 위에 놓기: 그 위치로 자유롭게 이동 (위치에 따라 역할이 정해짐)
// 실제 이동 규칙은 부모가 lineupOps.applyDrop으로 처리한다.
// ─────────────────────────────────────────────

interface Props {
  players: Player[];
  lineup: Lineup;
  color: string;
  onDrop(playerId: string, target: DropTarget): void;
  /** 다시 쓸 수 없는 선수 (벤치에서 흐리게) */
  unavailable?: string[];
  injured?: string[];
  benchTitle?: string;
  /** 옮긴 위치를 포메이션 기본 위치로 되돌리기 */
  onResetPositions?(): void;
}

export function LineupBoard(props: Props) {
  const { players, lineup, color, onDrop, unavailable = [], injured = [], benchTitle = '벤치', onResetPositions } = props;
  const [selected, setSelected] = useState<string | null>(null);
  /** 지금 끌고 있는 선수 (스크롤 영역 밖으로도 보이도록 오버레이로 그린다) */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const pitchRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  const slots = resolveSlots(lineup);
  const slotOf = (playerId: string) => Object.keys(lineup.slots).find((k) => lineup.slots[k] === playerId);
  const byId = new Map(players.map((p) => [p.id, p]));
  const onPitch = new Set(Object.values(lineup.slots).filter(Boolean) as string[]);
  const bench = players.filter((p) => !onPitch.has(p.id));

  const drop = (playerId: string, target: DropTarget) => {
    setSelected(null);
    onDrop(playerId, target);
  };

  /** 화면 좌표 → 경기장 좌표(%) */
  const toPitchPoint = (clientX: number, clientY: number): Point | null => {
    const rect = pitchRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 };
  };

  // 손가락(포인터) 아래에 있는 것: 다른 선수 자리·벤치를 먼저, 없으면 빈 잔디
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const ownSlot = `slot:${slotOf(String(args.active.id))}`;
    const target = hits.find((h) => h.id !== 'pitch' && h.id !== ownSlot);
    return target ? [target] : hits.filter((h) => h.id === 'pitch');
  };

  // 드래그 중 손가락/마우스의 마지막 화면 위치 (자동 스크롤돼도 정확하게)
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const trackPointer = (e: PointerEvent | TouchEvent) => {
    const t = 'touches' in e ? e.touches[0] : e;
    if (t) lastPointer.current = { x: t.clientX, y: t.clientY };
  };
  const startTracking = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
    lastPointer.current = null;
    window.addEventListener('pointermove', trackPointer);
    window.addEventListener('touchmove', trackPointer, { passive: true });
  };
  const stopTracking = () => {
    setDraggingId(null);
    window.removeEventListener('pointermove', trackPointer);
    window.removeEventListener('touchmove', trackPointer);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    stopTracking();
    const { active, over } = event;
    if (!over) return;
    const playerId = String(active.id);
    const overId = String(over.id);
    if (overId === 'bench') return drop(playerId, { kind: 'bench' });
    if (overId !== 'pitch') return drop(playerId, { kind: 'slot', slotId: overId.replace('slot:', '') });

    // 빈 잔디: 마지막 손가락 위치 (없으면 처음 누른 곳 + 끌고 간 거리)
    let pointer = lastPointer.current;
    if (!pointer) {
      const start = event.activatorEvent as MouseEvent | TouchEvent;
      const origin = 'touches' in start ? (start.touches[0] ?? start.changedTouches[0]) : start;
      if (origin) pointer = { x: origin.clientX + event.delta.x, y: origin.clientY + event.delta.y };
    }
    const point = pointer && toPitchPoint(pointer.x, pointer.y);
    if (point) drop(playerId, { kind: 'point', point });
  };

  // 탭 이동: 선수를 먼저 누르고, 이동할 곳을 누른다
  const tapPlayer = (id: string) => {
    if (unavailable.includes(id)) return;
    if (!selected) return setSelected(id);
    if (selected === id) return setSelected(null);
    // 다른 선수를 눌렀다면 그 선수의 자리로 이동
    const slotId = Object.keys(lineup.slots).find((k) => lineup.slots[k] === id);
    if (slotId) drop(selected, { kind: 'slot', slotId });
    else setSelected(id);
  };
  const tapSlot = (slotId: string) => selected && drop(selected, { kind: 'slot', slotId });
  const tapPitch = (e: React.MouseEvent) => {
    if (!selected) return;
    const point = toPitchPoint(e.clientX, e.clientY);
    if (point) drop(selected, { kind: 'point', point });
  };
  const tapBench = () => selected && drop(selected, { kind: 'bench' });

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={startTracking} onDragCancel={stopTracking} onDragEnd={handleDragEnd}>
      <div className="board-head">
        <span className="badge" data-testid="shape">현재 모양 <b>{shapeName(lineup)}</b></span>
        {onResetPositions && lineup.positions && Object.keys(lineup.positions).length > 0 && (
          <button className="btn btn--text btn--inline" onClick={onResetPositions}>↺ 기본 위치로</button>
        )}
      </div>
      <div className="board">
        <PitchDrop color={color} pitchRef={pitchRef} onTap={tapPitch} active={Boolean(selected)}>
          <PitchLines />
          {slots.map((slot) => {
            const pid = lineup.slots[slot.id];
            const player = pid ? byId.get(pid) : undefined;
            return (
              <SlotDrop key={slot.id} id={`slot:${slot.id}`} x={slot.x} y={slot.y} onTap={() => tapSlot(slot.id)}>
                {player ? (
                  <Chip
                    player={player}
                    selected={selected === player.id}
                    injured={injured.includes(player.id)}
                    misfit={fitMultiplier(player.role, slot.role) < 1}
                    onTap={() => tapPlayer(player.id)}
                  />
                ) : (
                  <span className="slot-empty">{slot.label}</span>
                )}
                <span className="slot-label">{slot.label}</span>
              </SlotDrop>
            );
          })}
        </PitchDrop>

        <BenchDrop onTap={tapBench} title={benchTitle} active={Boolean(selected)}>
          {bench.length === 0 && <p className="muted small">벤치에 선수가 없어요</p>}
          {bench.map((p) => (
            <Chip
              key={p.id}
              player={p}
              selected={selected === p.id}
              disabled={unavailable.includes(p.id)}
              injured={injured.includes(p.id)}
              onTap={() => tapPlayer(p.id)}
            />
          ))}
        </BenchDrop>
      </div>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {draggingId && byId.get(draggingId) && (
            <div className="chip chip--overlay" style={{ '--team': onPitch.has(draggingId) ? color : '#5b7a68' } as React.CSSProperties}>
              <ChipFace player={byId.get(draggingId)!} injured={injured.includes(draggingId)} />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
      <p className="hint">
        💡 선수를 <b>빈 잔디</b>에 놓으면 그 위치로 자유롭게 옮겨지고, <b>다른 선수</b> 위에 놓으면 자리를 바꿔요.
        선수를 누른 뒤 원하는 곳을 눌러도 돼요. 서 있는 위치에 따라 수비·미드·공격 역할이 정해지고, 주황 테두리는 원래 포지션과 다른 역할이에요.
      </p>
    </DndContext>
  );
}

function PitchDrop(props: {
  color: string;
  active: boolean;
  pitchRef: React.MutableRefObject<HTMLDivElement | null>;
  onTap(e: React.MouseEvent): void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pitch' });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        props.pitchRef.current = el;
      }}
      className={`pitch ${isOver ? 'pitch--over' : ''} ${props.active ? 'pitch--target' : ''}`}
      style={{ '--team': props.color } as React.CSSProperties}
      onClick={props.onTap}
      data-testid="pitch"
    >
      {props.children}
    </div>
  );
}

function SlotDrop(props: { id: string; x: number; y: number; onTap(): void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <div
      ref={setNodeRef}
      className={`slot ${isOver ? 'slot--over' : ''}`}
      style={{ left: `${props.x}%`, top: `${props.y}%` }}
      onClick={(e) => {
        e.stopPropagation();
        props.onTap();
      }}
      data-testid={props.id}
    >
      {props.children}
    </div>
  );
}

function BenchDrop(props: { title: string; active: boolean; onTap(): void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'bench' });
  return (
    <div
      ref={setNodeRef}
      className={`bench ${isOver ? 'bench--over' : ''} ${props.active ? 'bench--target' : ''}`}
      onClick={props.onTap}
      data-testid="bench"
    >
      <h4>{props.title}</h4>
      <div className="bench__list">{props.children}</div>
    </div>
  );
}

interface ChipProps {
  player: Player;
  selected: boolean;
  disabled?: boolean;
  injured?: boolean;
  misfit?: boolean;
  onTap(): void;
}

function Chip({ player, selected, disabled, injured, misfit, onTap }: ChipProps) {
  // 끄는 동안 원래 자리는 흐리게 두고, 손가락을 따라다니는 모습은 DragOverlay가 그린다
  // (벤치 목록이 스크롤 영역이라 직접 옮기면 영역 밖에서 잘리기 때문)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: player.id, disabled });
  const cls = [
    'chip',
    selected && 'chip--selected',
    disabled && 'chip--disabled',
    misfit && 'chip--misfit',
    isDragging && 'chip--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={cls}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      data-testid={`chip-${player.name}`}
    >
      <ChipFace player={player} injured={injured} />
    </div>
  );
}

/** 선수 칩의 겉모습 (보드 위 칩과 드래그 오버레이가 함께 쓴다) */
function ChipFace({ player, injured }: { player: Player; injured?: boolean }) {
  return (
    <>
      <PlayerAvatar player={player} size={40} />
      <span className="chip__ovr">{player.overall}</span>
      {injured && <span className="chip__badge">🚑</span>}
      <span className="chip__name">{player.name}</span>
    </>
  );
}

function PitchLines() {
  return (
    <svg className="pitch__lines" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden>
      <rect x="2" y="2" width="96" height="136" />
      <line x1="2" y1="70" x2="98" y2="70" />
      <circle cx="50" cy="70" r="11" />
      <rect x="22" y="2" width="56" height="20" />
      <rect x="36" y="2" width="28" height="7" />
      <rect x="22" y="118" width="56" height="20" />
      <rect x="36" y="131" width="28" height="7" />
    </svg>
  );
}
