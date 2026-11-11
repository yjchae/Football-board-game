import type { SegmentContext, SideContext } from '../domain/match';

// ─────────────────────────────────────────────
// AI(제미나이/클로드) 공통 프롬프트
// 두 모델 모두 같은 JSON 형식으로 답하도록 요청한다.
// ─────────────────────────────────────────────

export const MATCH_SYSTEM_PROMPT = `너는 어린이를 위한 축구 보드게임의 경기 해설가이자 시뮬레이터야.
주어진 두 팀의 선수 능력치, 포지션, 포메이션, 현재 점수를 보고 지정된 시간 구간의 경기 이벤트를 만들어.

규칙:
- 능력치가 높고 포지션이 맞는 팀이 유리하지만, 축구답게 의외의 결과도 가끔 나와야 해.
- 15분 구간에 골은 보통 0~2개. 이벤트는 4~9개.
- 반드시 주어진 선수 id만 사용하고, 그 선수가 실제로 경기장에 있는 팀(side)과 맞춰.
- 문장은 한국어, 초등학생이 읽기 쉽고 신나는 해설 말투. 폭력적이거나 무서운 표현은 금지.
- 골, 결정적 선방, 퇴장 같은 명장면은 highlight: true.
- type은 goal, shot, save, chance, foul, yellow, red, injury, corner, offside 중 하나.
- save 이벤트의 side와 playerId는 막아낸 골키퍼 쪽이야.
- 오직 JSON만 출력해. 설명이나 마크다운 금지.`;

function describeSide(s: SideContext): string {
  const field = s.onPitch
    .map(
      ({ player: p, slotLabel }) =>
        `  - id:${p.id} | ${p.name} #${p.number} | 자리:${slotLabel} (원래 ${p.position}) | OVR ${p.overall} | 속${p.stats.pace} 슛${p.stats.shooting} 패${p.stats.passing} 드${p.stats.dribbling} 수${p.stats.defending} 피${p.stats.physical}`,
    )
    .join('\n');
  return `${s.side === 'home' ? '홈' : '원정'}팀 "${s.teamName}" (${s.formation}, 경기장 ${s.onPitch.length}명)\n${field}`;
}

export function buildSegmentPrompt(ctx: SegmentContext): string {
  const { start, end, half } = ctx.segment;
  const recent = ctx.history
    .filter((e) => e.type !== 'info')
    .slice(-12)
    .map((e) => `  ${e.minute}' ${e.text}`)
    .join('\n');

  const summaryRule = ctx.isLastOfHalf
    ? `\n이 구간은 ${half === 1 ? '전반전' : '후반전'}의 마지막이야. "summary" 필드에 ${half === 1 ? '전반' : '후반'} 정리를 넣어줘 (title: 한 줄 제목, text: 3~4문장 정리, mvpPlayerId: 이 하프의 MVP 선수 id).`
    : '';

  return `${describeSide(ctx.home)}

${describeSide(ctx.away)}

현재 점수: 홈 ${ctx.score.home} : ${ctx.score.away} 원정
${recent ? `지금까지의 주요 장면:\n${recent}\n` : ''}
${start + 1}분부터 ${end}분까지의 이벤트를 만들어줘.${summaryRule}

JSON 형식:
{
  "events": [
    { "minute": ${start + 3}, "type": "shot", "side": "home", "playerId": "선수id", "assistId": "선택", "text": "해설 문장", "highlight": false }
  ]${ctx.isLastOfHalf ? `,\n  "summary": { "title": "...", "text": "...", "mvpPlayerId": "선수id" }` : ''}
}`;
}

export const CARD_SCAN_PROMPT = `이 사진은 실물 축구 선수 카드야. 카드에서 읽을 수 있는 정보를 JSON으로만 답해.
읽을 수 없는 값은 카드 분위기와 포지션에 맞게 40~90 사이로 합리적으로 추정해.

{
  "name": "선수 이름 (카드 표기 그대로, 가능하면 한국어 표기도 괄호 없이 원문 유지)",
  "number": 등번호 숫자 (없으면 0),
  "position": "카드 포지션 표기 (예: ST, CAM, CB, GK)",
  "role": "GK | DF | MF | FW 중 하나",
  "overall": 종합 능력치 숫자,
  "stats": { "pace": 0, "shooting": 0, "passing": 0, "dribbling": 0, "defending": 0, "physical": 0 }
}`;

export const TEAM_SCAN_PROMPT = `이 사진에는 실물 축구 선수 카드가 여러 장 놓여 있어. 사진 속 카드를 빠짐없이 모두 찾아서 JSON으로만 답해.
- 카드가 아닌 물건은 무시해. 같은 카드를 두 번 적지 마.
- 읽을 수 없는 능력치는 카드 분위기와 포지션에 맞게 40~90 사이로 합리적으로 추정해.
- box는 사진 안에서 그 카드가 차지하는 영역이야. [ymin, xmin, ymax, xmax] 형식으로, 사진 전체를 0~1000으로 본 정수 좌표를 써.

{
  "cards": [
    {
      "name": "선수 이름 (카드 표기 그대로)",
      "number": 등번호 숫자 (없으면 0),
      "position": "카드 포지션 표기 (예: ST, CAM, CB, GK)",
      "role": "GK | DF | MF | FW 중 하나",
      "overall": 종합 능력치 숫자,
      "stats": { "pace": 0, "shooting": 0, "passing": 0, "dribbling": 0, "defending": 0, "physical": 0 },
      "box": [ymin, xmin, ymax, xmax]
    }
  ]
}`;
