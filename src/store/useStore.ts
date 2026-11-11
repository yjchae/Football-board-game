import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { autoLineup, changeFormation, emptyLineup } from '../domain/formations';
import { lineupFromPhoto } from '../domain/positions';
import type { AiSettings, Lineup, Player, Point, Team } from '../domain/types';
import { uid } from '../utils/id';
import { createDemoTeams } from './demoTeams';
import { appStorage } from './storage';

// ─────────────────────────────────────────────
// 앱 전역 상태 (팀/선수/AI 설정) — 이 기기 브라우저에 자동 저장 (store/storage.ts)
// ─────────────────────────────────────────────

/** 선수를 여러 명 추가할 때 선발을 어떻게 세울지 */
export type Placement =
  | { kind: 'none' } // 지금 라인업 그대로
  | { kind: 'auto' } // 능력치·역할로 자동 배치
  | { kind: 'photo'; points: (Point | undefined)[] }; // 사진 속 카드 배치 그대로 (players와 같은 순서)

export const DEFAULT_SETTINGS: AiSettings = {
  engine: 'local',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  playbackMs: 1400,
};

export const TEAM_COLORS = ['#c6ff3d', '#ff5d73', '#4dd7ff', '#ffb547', '#b38cff', '#ffffff'];
export const TEAM_EMOJIS = ['🦁', '🐯', '🦅', '🐉', '🦈', '🐺', '⚡', '🔥', '🌟', '🚀'];

interface State {
  teams: Team[];
  settings: AiSettings;

  addTeam(name: string, emoji: string, color: string): string;
  updateTeam(teamId: string, patch: Partial<Pick<Team, 'name' | 'emoji' | 'color'>>): void;
  removeTeam(teamId: string): void;

  addPlayer(teamId: string, player: Omit<Player, 'id'>): void;
  /** 여러 명 한 번에 추가 + 선발 배치 방법 */
  addPlayers(teamId: string, players: Omit<Player, 'id'>[], placement: Placement): void;
  updatePlayer(teamId: string, player: Player): void;
  removePlayer(teamId: string, playerId: string): void;

  setLineup(teamId: string, lineup: Lineup): void;
  setFormation(teamId: string, formationId: string): void;
  autoArrange(teamId: string): void;

  updateSettings(patch: Partial<AiSettings>): void;
  loadDemo(): void;
}

const mapTeam = (teams: Team[], id: string, fn: (t: Team) => Team) => teams.map((t) => (t.id === id ? fn(t) : t));

export const useStore = create<State>()(
  persist(
    (set) => ({
      teams: [],
      settings: DEFAULT_SETTINGS,

      addTeam(name, emoji, color) {
        const id = uid('team-');
        set((s) => ({ teams: [...s.teams, { id, name, emoji, color, players: [], lineup: emptyLineup() }] }));
        return id;
      },
      updateTeam(teamId, patch) {
        set((s) => ({ teams: mapTeam(s.teams, teamId, (t) => ({ ...t, ...patch })) }));
      },
      removeTeam(teamId) {
        set((s) => ({ teams: s.teams.filter((t) => t.id !== teamId) }));
      },

      addPlayer(teamId, player) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => ({ ...t, players: [...t.players, { ...player, id: uid('p-') }] })),
        }));
      },
      addPlayers(teamId, players, placement) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => {
            const added = players.map((p) => ({ ...p, id: uid('p-') }));
            const all = [...t.players, ...added];
            const lineup =
              placement.kind === 'photo'
                ? lineupFromPhoto(added, placement.points, t.lineup.formationId)
                : placement.kind === 'auto'
                  ? autoLineup(all, t.lineup.formationId)
                  : t.lineup;
            return { ...t, players: all, lineup };
          }),
        }));
      },
      updatePlayer(teamId, player) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => ({
            ...t,
            players: t.players.map((p) => (p.id === player.id ? player : p)),
          })),
        }));
      },
      removePlayer(teamId, playerId) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => {
            const slots = { ...t.lineup.slots };
            for (const k of Object.keys(slots)) if (slots[k] === playerId) slots[k] = null;
            return { ...t, players: t.players.filter((p) => p.id !== playerId), lineup: { ...t.lineup, slots } };
          }),
        }));
      },

      setLineup(teamId, lineup) {
        set((s) => ({ teams: mapTeam(s.teams, teamId, (t) => ({ ...t, lineup })) }));
      },
      setFormation(teamId, formationId) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => ({ ...t, lineup: changeFormation(t.lineup, t.players, formationId) })),
        }));
      },
      autoArrange(teamId) {
        set((s) => ({
          teams: mapTeam(s.teams, teamId, (t) => ({ ...t, lineup: autoLineup(t.players, t.lineup.formationId) })),
        }));
      },

      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
      loadDemo() {
        set((s) => ({ teams: [...s.teams, ...createDemoTeams()] }));
      },
    }),
    {
      name: 'card-football-v1',
      // 카드 사진이 커서 IndexedDB에 저장 (예전 localStorage 데이터는 자동 이전)
      storage: createJSONStorage(() => appStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    },
  ),
);
