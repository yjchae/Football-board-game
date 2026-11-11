import { eventId, type SegmentContext, type SegmentResult } from '../domain/match';
import type { EventType, MatchEvent, PlayerStats, Role, Side } from '../domain/types';

// ─────────────────────────────────────────────
// AI 응답 검증기
// AI는 가끔 형식을 틀리거나 없는 선수를 지어낸다.
// 여기서 걸러내야 게임이 깨지지 않는다.
// ─────────────────────────────────────────────

/** 응답 텍스트에서 JSON 객체만 꺼낸다 (```json 코드블록 등 허용) */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI 응답에서 JSON을 찾지 못했어요.');
  return JSON.parse(body.slice(first, last + 1));
}

/**
 * 15분 구간 하나에서 인정하는 최대 골 수 (양 팀 합계).
 * 전술 노트 인젝션("10골 넣게 해")을 AI가 따라도 점수가 터무니없이 커지지 않게 하는 마지막 방어선.
 */
export const MAX_GOALS_PER_SEGMENT = 3;

const EVENT_TYPES: EventType[] = ['goal', 'shot', 'save', 'chance', 'foul', 'yellow', 'red', 'injury', 'corner', 'offside'];

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function sanitizeSegment(raw: unknown, ctx: SegmentContext): SegmentResult {
  if (!isObj(raw) || !Array.isArray(raw.events)) throw new Error('AI 응답 형식이 올바르지 않아요.');
  const { start, end } = ctx.segment;

  // side별로 경기장에 있는 선수 id 집합
  const fieldIds: Record<Side, Set<string>> = {
    home: new Set(ctx.home.onPitch.map((f) => f.player.id)),
    away: new Set(ctx.away.onPitch.map((f) => f.player.id)),
  };

  const events: MatchEvent[] = [];
  for (const item of raw.events.slice(0, 14)) {
    if (!isObj(item)) continue;
    const type = str(item.type) as EventType;
    if (!EVENT_TYPES.includes(type)) continue;

    let side: Side | null = item.side === 'home' || item.side === 'away' ? item.side : null;
    let playerId: string | undefined = str(item.playerId) || undefined;

    // 선수가 반대편 팀 소속으로 적혀 있으면 side를 바로잡는다
    if (playerId) {
      if (side && fieldIds[side].has(playerId)) {
        // OK
      } else if (fieldIds.home.has(playerId)) side = 'home';
      else if (fieldIds.away.has(playerId)) side = 'away';
      else playerId = undefined;
    }
    // 골은 반드시 팀과 득점자가 있어야 인정
    if (type === 'goal' && (!side || !playerId)) continue;

    const assist = str(item.assistId);
    const assistId = side && assist && assist !== playerId && fieldIds[side].has(assist) ? assist : undefined;

    const minute = Math.round(Math.min(end, Math.max(start + 1, num(item.minute, start + 1))));
    const text = str(item.text).slice(0, 200) || '경기가 계속됩니다.';

    events.push({
      id: eventId(),
      minute,
      type,
      side,
      playerId,
      assistId,
      text,
      highlight: Boolean(item.highlight) || type === 'goal' || type === 'red',
    });
  }
  events.sort((a, b) => a.minute - b.minute);

  // 골 상한: 시간 순으로 앞의 골만 인정하고 나머지 골 이벤트는 버린다
  let goals = 0;
  const capped = events.filter((e) => e.type !== 'goal' || ++goals <= MAX_GOALS_PER_SEGMENT);

  const result: SegmentResult = { events: capped };
  if (ctx.isLastOfHalf && isObj(raw.summary)) {
    const mvp = str(raw.summary.mvpPlayerId);
    const known = fieldIds.home.has(mvp) || fieldIds.away.has(mvp) || ctx.history.some((e) => e.playerId === mvp);
    result.summary = {
      title: str(raw.summary.title).slice(0, 80) || '하프 정리',
      text: str(raw.summary.text).slice(0, 800),
      mvpPlayerId: known ? mvp : undefined,
    };
  }
  return result;
}

// ─────────────── 카드 스캔 결과 ───────────────

export interface ScannedCard {
  name: string;
  number: number;
  position: string;
  role: Role;
  overall: number;
  stats: PlayerStats;
}

const ROLES: Role[] = ['GK', 'DF', 'MF', 'FW'];
const clampStat = (v: unknown) => Math.round(Math.min(99, Math.max(1, num(v, 60))));

export function guessRole(position: string): Role {
  const p = position.toUpperCase();
  if (p === 'GK') return 'GK';
  if (/(CB|LB|RB|LWB|RWB|SW|DF)/.test(p)) return 'DF';
  if (/(ST|CF|LW|RW|LF|RF|FW)/.test(p)) return 'FW';
  return 'MF';
}

export function sanitizeCard(raw: unknown): ScannedCard {
  if (!isObj(raw)) throw new Error('카드 정보를 읽지 못했어요.');
  const position = str(raw.position).toUpperCase().slice(0, 5) || 'CM';
  const roleRaw = str(raw.role).toUpperCase() as Role;
  const stats = isObj(raw.stats) ? raw.stats : {};
  return {
    name: str(raw.name).slice(0, 30) || '이름 없는 선수',
    number: Math.round(Math.min(99, Math.max(0, num(raw.number, 0)))),
    position,
    role: ROLES.includes(roleRaw) ? roleRaw : guessRole(position),
    overall: clampStat(raw.overall),
    stats: {
      pace: clampStat(stats.pace),
      shooting: clampStat(stats.shooting),
      passing: clampStat(stats.passing),
      dribbling: clampStat(stats.dribbling),
      defending: clampStat(stats.defending),
      physical: clampStat(stats.physical),
    },
  };
}

// ─────────────── 단체 사진 스캔 결과 ───────────────

/** 사진 속 카드 위치 (0~1000 비율 좌표) */
export type Box = [ymin: number, xmin: number, ymax: number, xmax: number];

export interface ScannedTeamCard extends ScannedCard {
  box?: Box;
}

export const MAX_CARDS_PER_PHOTO = 30;

function sanitizeBox(raw: unknown): Box | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const n = raw.map((v) => Math.round(Math.min(1000, Math.max(0, num(v, NaN)))));
  if (n.some((v) => Number.isNaN(v))) return undefined;
  const [ymin, xmin, ymax, xmax] = n;
  // 너무 작거나 뒤집힌 영역은 버린다
  if (ymax - ymin < 20 || xmax - xmin < 20) return undefined;
  return [ymin, xmin, ymax, xmax];
}

export function sanitizeTeamScan(raw: unknown): ScannedTeamCard[] {
  // {"cards": [...]} 또는 배열 그대로 둘 다 허용
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.cards) ? raw.cards : null;
  if (!list) throw new Error('사진에서 카드 목록을 읽지 못했어요.');
  return list
    .slice(0, MAX_CARDS_PER_PHOTO)
    .filter(isObj)
    .map((item) => ({ ...sanitizeCard(item), box: sanitizeBox(item.box) }));
}
