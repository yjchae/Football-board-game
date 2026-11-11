import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { fitMultiplier } from '../domain/match';
import { getFormation } from '../domain/formations';
import type { DropTarget } from '../domain/lineupOps';
import type { Lineup, Player } from '../domain/types';
import { PlayerAvatar } from './PlayerCard';

// ─────────────────────────────────────────────
// 포지션 보드: 드래그앤드롭 + 탭 두 번(선택→목적지)으로 선수 이동
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
}

export function LineupBoard({ players, lineup, color, onDrop, unavailable = [], injured = [], benchTitle = '벤치' }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );

  const formation = getFormation(lineup.formationId);
  const byId = new Map(players.map((p) => [p.id, p]));
  const onPitch = new Set(Object.values(lineup.slots).filter(Boolean) as string[]);
  const bench = players.filter((p) => !onPitch.has(p.id));

  const drop = (playerId: string, target: DropTarget) => {
    setSelected(null);
    onDrop(playerId, target);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const playerId = String(active.id);
    const overId = String(over.id);
    drop(playerId, overId === 'bench' ? { kind: 'bench' } : { kind: 'slot', slotId: overId.replace('slot:', '') });
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
  const tapBench = () => selected && drop(selected, { kind: 'bench' });

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="board">
        <div className="pitch" style={{ '--team': color } as React.CSSProperties}>
          <PitchLines />
          {formation.slots.map((slot) => {
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
        </div>

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
      <p className="hint">
        💡 선수를 끌어서 옮기거나, 선수를 누른 뒤 원하는 자리를 눌러도 돼요. 노란 테두리는 원래 포지션이 아닌 자리예요.
      </p>
    </DndContext>
  );
}

function SlotDrop(props: { id: string; x: number; y: number; onTap(): void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <div
      ref={setNodeRef}
      className={`slot ${isOver ? 'slot--over' : ''}`}
      style={{ left: `${props.x}%`, top: `${props.y}%` }}
      onClick={props.onTap}
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: player.id, disabled });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
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
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      data-testid={`chip-${player.name}`}
    >
      <PlayerAvatar player={player} size={40} />
      <span className="chip__ovr">{player.overall}</span>
      {injured && <span className="chip__badge">🚑</span>}
      <span className="chip__name">{player.name}</span>
    </div>
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
