import { describe, expect, it } from 'vitest';
import { isFatalVoiceError, isQuotaError, pcmToBuffer } from './cloudVoice';

/** 테스트용 가짜 오디오 (createBuffer만 흉내) */
const fakeContext = () =>
  ({
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
    },
  }) as unknown as BaseAudioContext;

describe('pcmToBuffer', () => {
  it('16비트 리틀 엔디언 PCM을 -1~1 사이 값으로 바꾼다', () => {
    // 0, 16384(0.5), -32768(-1)
    const pcm = new Uint8Array([0x00, 0x00, 0x00, 0x40, 0x00, 0x80]);
    const buffer = pcmToBuffer(fakeContext(), pcm);
    expect(buffer.sampleRate).toBe(24000);
    expect(Array.from(buffer.getChannelData(0))).toEqual([0, 0.5, -1]);
  });

  it('빈 음성도 오류 없이 처리한다', () => {
    expect(pcmToBuffer(fakeContext(), new Uint8Array()).length).toBe(1);
  });
});

describe('AI 목소리 오류 구분', () => {
  it('키 오류·모델 없음은 다시 시도하지 않는다', () => {
    expect(isFatalVoiceError(new Error('API key not valid'))).toBe(true);
    expect(isFatalVoiceError(new Error('models/x is not found'))).toBe(true);
    expect(isFatalVoiceError(new Error('503 UNAVAILABLE'))).toBe(false);
  });
  it('사용량 초과는 잠시 쉰다', () => {
    expect(isQuotaError(new Error('429 RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isQuotaError(new Error('network error'))).toBe(false);
  });
});
