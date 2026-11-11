import type { Player } from '../domain/types';

// ─────────────────────────────────────────────
// 선수 카드 (명단 화면용 큰 카드)
// ─────────────────────────────────────────────

const STAT_LABELS: [keyof Player['stats'], string][] = [
  ['pace', '속도'],
  ['shooting', '슈팅'],
  ['passing', '패스'],
  ['dribbling', '드리블'],
  ['defending', '수비'],
  ['physical', '피지컬'],
];

export function tierOf(overall: number): 'gold' | 'silver' | 'bronze' {
  if (overall >= 75) return 'gold';
  if (overall >= 65) return 'silver';
  return 'bronze';
}

export function PlayerAvatar({ player, size = 44 }: { player: Player; size?: number }) {
  return player.photo ? (
    <img className="avatar" src={player.photo} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar avatar--empty" style={{ width: size, height: size }}>
      {player.number || '?'}
    </span>
  );
}

interface Props {
  player: Player;
  onClick?: () => void;
}

export function PlayerCard({ player, onClick }: Props) {
  return (
    <button type="button" className={`pcard pcard--${tierOf(player.overall)}`} onClick={onClick}>
      <div className="pcard__top">
        <div className="pcard__ovr">
          <strong>{player.overall}</strong>
          <span>{player.position}</span>
        </div>
        <PlayerAvatar player={player} size={72} />
      </div>
      <div className="pcard__name">
        <span className="pcard__num">#{player.number}</span> {player.name}
      </div>
      <ul className="pcard__stats">
        {STAT_LABELS.map(([key, label]) => (
          <li key={key}>
            <b>{player.stats[key]}</b>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

export { STAT_LABELS };
