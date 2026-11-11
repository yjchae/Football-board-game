import type Anthropic from '@anthropic-ai/sdk';

// ─────────────────────────────────────────────
// AI 제공자 공통 인터페이스: "텍스트(+이미지) → 텍스트"
// 키는 사용자 브라우저에만 저장되고, 브라우저에서 직접 AI 서버로 호출한다.
// SDK는 실제로 쓸 때만 불러온다(첫 화면 로딩을 가볍게).
// ─────────────────────────────────────────────

export interface ImageInput {
  mimeType: string;
  base64: string;
}

export interface TextProvider {
  generate(system: string, prompt: string, image?: ImageInput): Promise<string>;
}

// ─────────────── Gemini ───────────────

export function geminiProvider(apiKey: string, model: string): TextProvider {
  return {
    async generate(system, prompt, image) {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const parts = [
        ...(image ? [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }] : []),
        { text: prompt },
      ];
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
        },
      });
      const text = response.text;
      if (!text) throw new Error('제미나이가 빈 응답을 보냈어요.');
      return text;
    },
  };
}

// ─────────────── Claude ───────────────

export function claudeProvider(apiKey: string, model: string): TextProvider {
  return {
    async generate(system, prompt, image) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (image) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
            data: image.base64,
          },
        });
      }
      content.push({ type: 'text', text: prompt });

      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content }],
        // 아이들이 기다리지 않도록 low effort로 빠르게 응답
        output_config: { effort: 'low' },
        // 안전 분류기가 거절하면 서버에서 자동으로 다른 모델로 이어서 처리
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      if (response.stop_reason === 'refusal') {
        throw new Error('클로드가 이 요청을 처리하지 않았어요. 다시 시도해 주세요.');
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (!text) throw new Error('클로드가 빈 응답을 보냈어요.');
      return text;
    },
  };
}
