import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { autoLineup, changeFormation, emptyLineup } from '../domain/formations';
import type { AiSettings, Lineup, Player, Team } from '../domain/types';
import { uid } from '../utils/id';
import { createDemoTeams } from './demoTeams';

// ─────────────────────────────────────────────
// 앱 전역 상태 (팀/선수/AI 설정) — 브라우저 localStorage에 자동 저장
// ─────────────────────────────────────────────

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
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    },
  ),
);
