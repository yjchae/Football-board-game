import { ARGENTINA } from './argentina';
import { BRASILEIRAO } from './brasileirao';
import { BUNDESLIGA } from './bundesliga';
import { EPL } from './epl';
import { EREDIVISIE } from './eredivisie';
import { JLEAGUE } from './jleague';
import { KLEAGUE } from './kleague';
import { LALIGA } from './laliga';
import { LIGUE1 } from './ligue1';
import { MLS } from './mls';
import { PORTUGAL } from './portugal';
import { SAUDI } from './saudi';
import { SCOTLAND } from './scotland';
import { SERIEA } from './seriea';
import { TURKEY } from './turkey';
import type { League, RealPlayer } from './shared';

// ─────────────────────────────────────────────
// 실존 선수 명단 (이적시장·랜덤 뽑기 공용 진입점)
//
// ⚠️ 주의
//  - 소속팀은 2025-26 시즌 무렵 기준이에요. 이적이 잦아서 지금과 다를 수 있어요.
//  - OVR(종합 능력치)은 공식 수치가 아니라 이 게임에서 쓰려고 정한 추정치예요.
//  - 등번호는 실제 번호를 쓰지 않고, 팀에 추가할 때 빈 번호를 자동으로 붙여요.
// ─────────────────────────────────────────────

export const LEAGUES: League[] = [
  { id: 'EPL', name: '프리미어리그', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'LALIGA', name: '라리가', flag: '🇪🇸' },
  { id: 'SERIEA', name: '세리에 A', flag: '🇮🇹' },
  { id: 'LIGUE1', name: '리그 1', flag: '🇫🇷' },
  { id: 'KLEAGUE', name: 'K리그', flag: '🇰🇷' },
  { id: 'MLS', name: 'MLS', flag: '🇺🇸' },
  { id: 'BRASILEIRAO', name: '브라질 세리이 A', flag: '🇧🇷' },
  { id: 'SAUDI', name: '사우디 프로리그', flag: '🇸🇦' },
  { id: 'BUNDESLIGA', name: '분데스리가', flag: '🇩🇪' },
  { id: 'EREDIVISIE', name: '에레디비시', flag: '🇳🇱' },
  { id: 'PORTUGAL', name: '프리메이라리가', flag: '🇵🇹' },
  { id: 'TURKEY', name: '튀르키예 쉬페르리그', flag: '🇹🇷' },
  { id: 'SCOTLAND', name: '스코틀랜드 프리미어십', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { id: 'JLEAGUE', name: 'J리그', flag: '🇯🇵' },
  { id: 'ARGENTINA', name: '아르헨티나 프리메라', flag: '🇦🇷' },
];

export const REAL_PLAYERS: RealPlayer[] = [
  ...EPL,
  ...LALIGA,
  ...SERIEA,
  ...LIGUE1,
  ...KLEAGUE,
  ...MLS,
  ...BRASILEIRAO,
  ...SAUDI,
  ...BUNDESLIGA,
  ...EREDIVISIE,
  ...PORTUGAL,
  ...TURKEY,
  ...SCOTLAND,
  ...JLEAGUE,
  ...ARGENTINA,
];
