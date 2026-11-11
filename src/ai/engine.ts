import { createLocalEngine } from '../domain/localEngine';
import type { MatchEngine, SegmentContext } from '../domain/match';
import type { AiSettings } from '../domain/types';
import { extractJson, sanitizeCard, sanitizeSegment, sanitizeTeamScan, type ScannedCard, type ScannedTeamCard } from './parse';
import { buildSegmentPrompt, CARD_SCAN_PROMPT, MATCH_SYSTEM_PROMPT, TEAM_SCAN_PROMPT } from './prompts';
import { claudeProvider, geminiProvider, type ImageInput, type TextProvider } from './providers';

// ─────────────────────────────────────────────
// 설정에 따라 알맞은 엔진/스캐너를 만들어 주는 진입점
// ─────────────────────────────────────────────

/** AI 오류: 아이용 짧은 안내 + 보호자가 원인을 볼 수 있는 원문 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

/** 사람이 읽기 쉬운 오류 문구로 바꾼다 */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API key not valid|invalid x-api-key|authentication|401|403|PERMISSION_DENIED/i.test(msg)) {
    return 'API 키가 올바르지 않거나 권한이 없어요. 키를 다시 확인해 주세요.';
  }
  // "limit: 0" = 이 모델은 이 키(프로젝트)에서 무료로 쓸 수 있는 양이 아예 없음
  if (/limit:\s*0\b|free_tier.*limit.*\b0\b/i.test(msg)) {
    return '이 키로는 선택한 모델의 무료 사용량이 없어요(한도 0). 설정에서 다른 모델을 고르거나, AI Studio에서 결제(유료 등급)를 설정해야 해요.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(msg)) {
    return '짧은 시간에 너무 많이 요청했거나 오늘 사용량을 다 썼어요. 잠시 후 다시 하거나 다른 모델을 골라 주세요.';
  }
  if (/not found|404|is not supported/i.test(msg)) return '모델 이름을 찾을 수 없어요. 설정에서 "사용 가능한 모델 불러오기"로 골라 주세요.';
  if (/connection|network|fetch/i.test(msg)) return '인터넷 연결 또는 AI 서버 접속에 실패했어요.';
  return msg.slice(0, 120);
}

function toAiError(err: unknown): AiError {
  const raw = err instanceof Error ? err.message : String(err);
  return new AiError(friendlyError(err), raw.slice(0, 600));
}

function providerFor(settings: AiSettings): TextProvider | null {
  if (settings.engine === 'gemini' && settings.geminiKey) {
    return geminiProvider(settings.geminiKey, settings.geminiModel);
  }
  if (settings.engine === 'claude' && settings.claudeKey) {
    return claudeProvider(settings.claudeKey, settings.claudeModel);
  }
  return null;
}

export function engineLabel(settings: AiSettings): string {
  if (settings.engine === 'gemini' && settings.geminiKey) return `제미나이 (${settings.geminiModel})`;
  if (settings.engine === 'claude' && settings.claudeKey) return `클로드 (${settings.claudeModel})`;
  return '오프라인 엔진';
}

/** AI 엔진 생성. AI가 실패하면 그 구간만 오프라인 엔진으로 대신 진행한다. */
export function createEngine(settings: AiSettings, onFallback?: (reason: string) => void): MatchEngine {
  const local = createLocalEngine();
  const provider = providerFor(settings);
  if (!provider) return local;

  return {
    label: engineLabel(settings),
    async simulateSegment(ctx: SegmentContext) {
      try {
        const text = await provider.generate(MATCH_SYSTEM_PROMPT, buildSegmentPrompt(ctx));
        return sanitizeSegment(extractJson(text), ctx);
      } catch (err) {
        onFallback?.(friendlyError(err));
        return local.simulateSegment(ctx);
      }
    },
  };
}

export function canScanCards(settings: AiSettings): boolean {
  return providerFor(settings) !== null;
}

/** 카드 사진 → 선수 정보 */
export async function scanCard(settings: AiSettings, image: ImageInput): Promise<ScannedCard> {
  const provider = providerFor(settings);
  if (!provider) throw new Error('카드 인식을 하려면 설정에서 AI 키를 연결해 주세요.');
  try {
    const text = await provider.generate('너는 축구 카드 판독기야. JSON만 출력해.', CARD_SCAN_PROMPT, image);
    return sanitizeCard(extractJson(text));
  } catch (err) {
    throw toAiError(err);
  }
}

/** 여러 장의 카드가 찍힌 단체 사진 → 선수 목록 */
export async function scanTeamPhoto(settings: AiSettings, image: ImageInput): Promise<ScannedTeamCard[]> {
  const provider = providerFor(settings);
  if (!provider) throw new Error('카드 인식을 하려면 설정에서 AI 키를 연결해 주세요.');
  try {
    const text = await provider.generate('너는 축구 카드 판독기야. JSON만 출력해.', TEAM_SCAN_PROMPT, image);
    return sanitizeTeamScan(extractJson(text));
  } catch (err) {
    throw toAiError(err);
  }
}

/** 내 제미나이 키로 쓸 수 있는 모델 목록 (텍스트 생성 가능한 gemini 모델만) */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const names: string[] = [];
    for await (const model of await ai.models.list()) {
      const name = model.name?.replace(/^models\//, '') ?? '';
      const canGenerate = model.supportedActions?.includes('generateContent') ?? true;
      if (canGenerate && /^gemini/.test(name) && !/(embedding|tts|image|audio|live)/.test(name)) names.push(name);
    }
    return names.sort();
  } catch (err) {
    throw toAiError(err);
  }
}

/** 연결 테스트 */
export async function testConnection(settings: AiSettings): Promise<string> {
  const provider = providerFor(settings);
  if (!provider) throw new Error('키가 입력되지 않았어요.');
  try {
    const text = await provider.generate('JSON만 출력해.', '{"ok": true} 를 그대로 출력해.');
    extractJson(text);
    return '연결 성공!';
  } catch (err) {
    throw toAiError(err);
  }
}
