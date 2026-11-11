// ─────────────────────────────────────────────
// AI 남자 해설 목소리 — 제미나이 음성 합성(TTS)
//
//  아이폰·아이패드에는 한국어 남자 목소리가 기본으로 없어서
//  기기 목소리만으로는 남자 해설을 낼 수 없다.
//  그래서 제미나이 키가 있으면 문장을 남자 목소리 음성으로 만들어 받아 재생한다.
//
//  - 받은 음성은 24kHz 16비트 PCM → Web Audio 버퍼로 바꿔 효과음과 같은 오디오로 재생
//  - 같은 문장은 다시 만들지 않게 최근 것을 기억해 둔다
// ─────────────────────────────────────────────

/** 써 볼 음성 합성 모델 (앞에서부터 시도, 없는 모델이면 다음 것) */
const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];

/** 제미나이 기본 목소리 중 남자 목소리 (힘 있고 들뜬 말투) */
export const MALE_VOICE = 'Fenrir';

/** 음성을 받아 오는 데 이보다 오래 걸리면 포기하고 기기 목소리로 읽는다 */
const TIMEOUT_MS = 8000;

const SAMPLE_RATE = 24000;

let workingModel: string | null = null;

/** 모델이 없거나 지원하지 않는다는 오류인지 */
const isMissingModel = (msg: string) => /not found|404|is not supported|does not support/i.test(msg);

async function requestPcm(apiKey: string, text: string, urgent: boolean): Promise<Uint8Array> {
  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  const style = urgent ? '흥분한 목소리로 크게 외치듯이' : '생생하고 힘 있게';
  const prompt = `한국 축구 중계 캐스터처럼 ${style} 읽어 주세요: ${text}`;

  const models = workingModel ? [workingModel] : TTS_MODELS;
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: MALE_VOICE } } },
        },
      });
      const data = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (!data) throw new Error('제미나이가 음성을 보내지 않았어요.');
      workingModel = model;
      return base64ToBytes(data);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isMissingModel(msg)) break; // 키·사용량 문제는 다른 모델로 바꿔도 같다
    }
  }
  throw lastError;
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 16비트 PCM(리틀 엔디언, 모노) → Web Audio 버퍼 */
export function pcmToBuffer(ac: BaseAudioContext, pcm: Uint8Array, sampleRate = SAMPLE_RATE): AudioBuffer {
  const count = Math.floor(pcm.length / 2);
  const buffer = ac.createBuffer(1, Math.max(count, 1), sampleRate);
  const channel = buffer.getChannelData(0);
  const view = new DataView(pcm.buffer, pcm.byteOffset, count * 2);
  for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

// ─────────────── 최근 문장 기억 ───────────────

const CACHE_SIZE = 40;
const cache = new Map<string, Promise<AudioBuffer>>();

/** 문장을 남자 목소리 음성으로 만든다 (실패하면 오류를 던진다) */
export function synthesizeMale(ac: AudioContext, apiKey: string, text: string, urgent: boolean): Promise<AudioBuffer> {
  const key = `${urgent ? '!' : ''}${text}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // 최근에 쓴 것으로 옮긴다
    cache.set(key, hit);
    return hit;
  }
  const job = requestPcm(apiKey, text, urgent).then((pcm) => pcmToBuffer(ac, pcm));
  job.catch(() => cache.delete(key)); // 실패한 건 기억하지 않는다
  cache.set(key, job);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return job;
}

/** 다시 시도해도 안 되는 오류 (키 오류·모델 없음·무료 한도 0) → 이번 접속 동안은 AI 목소리를 쓰지 않는다 */
export function isFatalVoiceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /API key not valid|401|403|PERMISSION_DENIED|limit:\s*0\b/i.test(msg) || isMissingModel(msg);
}

/** 사용량 초과 오류 (잠시 쉬었다가 다시 쓴다) */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
}
