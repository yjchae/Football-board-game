// ─────────────────────────────────────────────
// 게임 전체에서 쓰는 핵심 데이터 타입
// ─────────────────────────────────────────────

/** 포지션 그룹 (카드에 적힌 세부 포지션은 position 필드에 그대로 보관) */
export type Role = 'GK' | 'DF' | 'MF' | 'FW';

export interface PlayerStats {
  pace: number; // 속도
  shooting: number; // 슈팅
  passing: number; // 패스
  dribbling: number; // 드리블
  defending: number; // 수비
  physical: number; // 피지컬
}

export interface Player {
  id: string;
  name: string;
  number: number;
  role: Role;
  /** 카드에 적힌 원래 포지션 표기 (예: ST, CAM, LB) */
  position: string;
  overall: number;
  stats: PlayerStats;
  /** 카드 사진 (압축된 dataURL) */
  photo?: string;
}

/** 포메이션 위 한 자리 */
export interface FormationSlot {
  id: string;
  role: Role;
  label: string;
  /** 경기장 좌표(%) — x: 왼→오, y: 위(상대 골문)→아래(우리 골문) */
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  slots: FormationSlot[];
}

/** 라인업: 어떤 자리에 누가 서 있는지 */
export interface Lineup {
  formationId: string;
  /** slotId → playerId (빈 자리는 null) */
  slots: Record<string, string | null>;
}

export interface Team {
  id: string;
  name: string;
  emoji: string;
  color: string;
  players: Player[];
  lineup: Lineup;
}

// ─────────────── 경기 ───────────────

export type Side = 'home' | 'away';

export type EventType =
  | 'goal'
  | 'shot'
  | 'save'
  | 'chance'
  | 'foul'
  | 'yellow'
  | 'red'
  | 'injury'
  | 'corner'
  | 'offside'
  | 'sub'
  | 'info';

export interface MatchEvent {
  id: string;
  minute: number;
  type: EventType;
  side: Side | null;
  playerId?: string;
  assistId?: string;
  text: string;
  /** 하이라이트 장면 여부 */
  highlight: boolean;
}

export interface HalfSummary {
  half: 1 | 2;
  title: string;
  text: string;
  mvpPlayerId?: string;
  score: { home: number; away: number };
  stats: MatchStats;
}

export interface SideStats {
  goals: number;
  shots: number;
  saves: number;
  fouls: number;
  yellows: number;
  reds: number;
  corners: number;
}

export interface MatchStats {
  home: SideStats;
  away: SideStats;
}

// ─────────────── AI 설정 ───────────────

export type EngineKind = 'gemini' | 'claude' | 'local';

export interface AiSettings {
  engine: EngineKind;
  geminiKey: string;
  geminiModel: string;
  claudeKey: string;
  claudeModel: string;
  /** 이벤트 재생 속도 (ms) */
  playbackMs: number;
}
