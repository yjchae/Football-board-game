import { createLocalEngine } from '../domain/localEngine';
import type { MatchEngine, SegmentContext } from '../domain/match';
import type { AiSettings } from '../domain/types';
import { extractJson, sanitizeCard, sanitizeSegment, type ScannedCard } from './parse';
import { buildSegmentPrompt, CARD_SCAN_PROMPT, MATCH_SYSTEM_PROMPT } from './prompts';
import { claudeProvider, geminiProvider, type ImageInput, type TextProvider } from './providers';

// ─────────────────────────────────────────────
// 설정에 따라 알맞은 엔진/스캐너를 만들어 주는 진입점
// ─────────────────────────────────────────────

/** 사람이 읽기 쉬운 오류 문구로 바꾼다 */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API key not valid|invalid x-api-key|authentication|401|403/i.test(msg)) return 'API 키가 올바르지 않아요. 키를 다시 확인해 주세요.';
  if (/429|quota|rate/i.test(msg)) return 'AI 사용 한도를 넘었어요. 잠시 후 다시 해 주세요.';
  if (/not found|404/i.test(msg)) return '모델 이름을 찾을 수 없어요. 설정에서 모델 이름을 확인해 주세요.';
  if (/connection|network|fetch/i.test(msg)) return '인터넷 연결 또는 AI 서버 접속에 실패했어요.';
  return msg.slice(0, 120);
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
    throw new Error(friendlyError(err));
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
    throw new Error(friendlyError(err));
  }
}
