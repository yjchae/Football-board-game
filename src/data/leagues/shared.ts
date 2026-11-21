import type { Role } from '../../domain/types';

export type LeagueId =
  | 'EPL' | 'KLEAGUE' | 'MLS' | 'LIGUE1' | 'LALIGA' | 'SERIEA' | 'BRASILEIRAO' | 'SAUDI'
  | 'BUNDESLIGA' | 'EREDIVISIE' | 'PORTUGAL' | 'TURKEY' | 'SCOTLAND' | 'JLEAGUE' | 'ARGENTINA';

export interface League {
  id: LeagueId;
  name: string;
  flag: string;
}

export interface RealPlayer {
  name: string;
  club: string;
  league: LeagueId;
  /** 카드에 쓰는 세부 포지션 (ST, CAM, LB …) */
  position: string;
  role: Role;
  overall: number;
}

/** [이름, 소속팀, 포지션, 역할, OVR] */
type Row = [name: string, club: string, position: string, role: Role, overall: number];

export const rows = (league: LeagueId, list: Row[]): RealPlayer[] =>
  list.map(([name, club, position, role, overall]) => ({ name, club, league, position, role, overall }));
