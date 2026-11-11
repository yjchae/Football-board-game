import { useEffect, useState } from 'react';
import { AiError, listGeminiModels, testConnection } from '../ai/engine';
import { configureNarrator, narrate, stopNarration } from '../audio/narrator';
import { playSfx, releaseSfx, unlockSfx } from '../audio/sfx';
import { InstallGuide } from '../components/InstallGuide';
import type { EngineKind } from '../domain/types';
import { DEFAULT_SETTINGS, useStore } from '../store/useStore';

// ─────────────────────────────────────────────
// AI 연결 설정 — 키는 이 기기 브라우저에만 저장된다.
// ─────────────────────────────────────────────

const ENGINES: { value: EngineKind; title: string; desc: string }[] = [
  { value: 'gemini', title: '제미나이', desc: '내 Google AI Studio API 키로 진행' },
  { value: 'claude', title: '클로드', desc: '내 Anthropic API 키로 진행' },
  { value: 'local', title: '오프라인', desc: '키 없이 능력치 기반으로 진행' },
];

/** 중계 속도 = 장면 하나를 보여 주는 시간 (기존 저장값 2200·1400·700은 그대로 유지) */
export const SPEEDS = [
  { ms: 4500, label: '아주 천천히' },
  { ms: 3200, label: '천천히' },
  { ms: 2200, label: '조금 천천히' },
  { ms: 1400, label: '보통' },
  { ms: 700, label: '빠르게' },
];

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const [status, setStatus] = useState<{ ok: boolean; text: string; detail?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  // 효과음 테스트로 켠 무음 재생은 화면을 떠날 때 끈다
  useEffect(() => releaseSfx, []);

  const failStatus = (err: unknown) => ({
    ok: false,
    text: err instanceof Error ? err.message : String(err),
    detail: err instanceof AiError ? err.detail : undefined,
  });

  async function runTest() {
    setTesting(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await testConnection(settings) });
    } catch (err) {
      setStatus(failStatus(err));
    } finally {
      setTesting(false);
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    setStatus(null);
    try {
      const list = await listGeminiModels(settings.geminiKey);
      setModels(list);
      if (!list.length) setStatus({ ok: false, text: '이 키로 쓸 수 있는 제미나이 모델이 없어요.' });
    } catch (err) {
      setStatus(failStatus(err));
    } finally {
      setLoadingModels(false);
    }
  }

  return (
    <div className="settings">
      <h2 className="hero-title">AI <span>연결</span></h2>

      <InstallGuide variant="panel" />

      <div className="engine-cards">
        {ENGINES.map((e) => (
          <button
            key={e.value}
            className={`engine-card ${settings.engine === e.value ? 'on' : ''}`}
            onClick={() => { update({ engine: e.value }); setStatus(null); }}
          >
            <b>{e.title}</b>
            <span>{e.desc}</span>
          </button>
        ))}
      </div>

      {settings.engine === 'gemini' && (
        <section className="panel">
          <label className="field">
            <span>Gemini API 키</span>
            <input type="password" autoComplete="off" value={settings.geminiKey} onChange={(e) => update({ geminiKey: e.target.value.trim() })} placeholder="AIza…" />
          </label>
          <div className="field">
            <span>모델</span>
            <div className="row">
              {models.length > 0 ? (
                <select value={settings.geminiModel} onChange={(e) => { update({ geminiModel: e.target.value }); setStatus(null); }} aria-label="제미나이 모델">
                  {!models.includes(settings.geminiModel) && <option value={settings.geminiModel}>{settings.geminiModel}</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input value={settings.geminiModel} onChange={(e) => update({ geminiModel: e.target.value.trim() || DEFAULT_SETTINGS.geminiModel })} aria-label="제미나이 모델" />
              )}
              <button className="btn btn--ghost" disabled={!settings.geminiKey || loadingModels} onClick={loadModels}>
                {loadingModels ? '불러오는 중…' : '📋 사용 가능한 모델 불러오기'}
              </button>
            </div>
          </div>
          <p className="muted small">
            Google AI Studio(aistudio.google.com)에서 본인 구글 계정으로 로그인 → “Get API key”로 키를 만들어 붙여 넣으세요.
            “한도 0” 오류가 나오면 목록에서 <b>flash-lite</b>나 <b>flash</b>처럼 가벼운 모델을 골라 다시 테스트해 보세요.
          </p>
          <p className="muted small">
            ※ Google AI Plus·Pro 같은 <b>제미나이 앱 구독</b>과 <b>API 사용량</b>은 따로 관리돼요. API 한도는 AI Studio의 사용량·결제 화면에서 확인할 수 있어요.
          </p>
        </section>
      )}

      {settings.engine === 'claude' && (
        <section className="panel">
          <label className="field">
            <span>Anthropic API 키</span>
            <input type="password" autoComplete="off" value={settings.claudeKey} onChange={(e) => update({ claudeKey: e.target.value.trim() })} placeholder="sk-ant-…" />
          </label>
          <label className="field">
            <span>모델</span>
            <select value={settings.claudeModel} onChange={(e) => update({ claudeModel: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (기본)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
            </select>
          </label>
          <p className="muted small">Claude Console(platform.claude.com)에서 API 키를 발급받아 붙여 넣으세요.</p>
        </section>
      )}

      {settings.engine !== 'local' && (
        <div className="row">
          <button className="btn btn--primary" disabled={testing} onClick={runTest}>
            {testing ? '확인 중…' : '🔌 연결 테스트'}
          </button>
          {status && <span className={`status status--${status.ok ? 'ok' : 'error'}`}>{status.text}</span>}
        </div>
      )}
      {status?.detail && (
        <details className="error-detail">
          <summary>보호자용: 오류 원문 보기</summary>
          <pre>{status.detail}</pre>
        </details>
      )}

      <section className="panel">
        <span className="field-label">중계 속도</span>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s.ms} className={settings.playbackMs === s.ms ? 'on' : ''} onClick={() => update({ playbackMs: s.ms })}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="muted small">음성 해설이 켜져 있으면 해설이 끝날 때까지 다음 장면을 기다려요.</p>
      </section>

      <section className="panel">
        <span className="field-label">소리</span>
        <div className="toggles">
          <Toggle
            label="🔔 효과음"
            desc="휘슬·킥·드리블 소리, 골 함성"
            on={settings.sfx}
            onChange={(sfx) => update({ sfx })}
            testId="toggle-sfx"
          />
          <Toggle
            label="🎙️ 음성 해설"
            desc="중계 상황을 목소리로 읽어 줘요"
            on={settings.voice}
            onChange={(voice) => update({ voice })}
            testId="toggle-voice"
          />
          <Toggle
            label="🧔 AI 남자 목소리"
            desc={
              settings.geminiKey
                ? '제미나이로 남자 해설 목소리를 만들어요 (아이폰에서도 남자 목소리)'
                : '제미나이 API 키를 넣으면 쓸 수 있어요 (지금은 기기 목소리)'
            }
            on={settings.aiVoice}
            onChange={(aiVoice) => update({ aiVoice })}
            testId="toggle-ai-voice"
          />
        </div>
        <button
          className="btn btn--ghost"
          data-testid="sfx-test"
          onClick={() => {
            unlockSfx(); // 누른 순간 오디오를 깨워야 아이패드·아이폰에서도 들린다
            playSfx('fulltime');
          }}
        >
          🔊 효과음 들어보기
        </button>
        <button
          className="btn btn--ghost"
          data-testid="voice-test"
          onClick={() => {
            unlockSfx(); // AI 목소리도 효과음과 같은 오디오로 재생된다
            stopNarration();
            configureNarrator(settings.aiVoice ? settings.geminiKey : null);
            narrate('골! 골입니다! 멋진 슈팅으로 골망을 흔듭니다!', { urgent: true });
          }}
        >
          🎙️ 해설 목소리 들어보기
        </button>
        <p className="muted small">
          AI 남자 목소리는 제미나이 사용량을 조금씩 써요. 연결이 안 되거나 사용량을 다 쓰면 기기 목소리로 대신 읽어요. 효과음이 안 들리면 기기 음량과 아이패드·아이폰의 무음 모드(제어 센터 🔔)를
          확인해 주세요.
        </p>
      </section>

      <aside className="notice-box">
        🔒 API 키는 <b>이 기기에만</b> 저장돼요. 다른 사람이 같은 주소로 접속해도 이 키를 쓸 수 없고,
        이 기기(홈 화면 앱)로 게임하는 사람만 이 키를 사용해요. AI 서버(구글/Anthropic)로만 직접 전송돼요. AI 사용량에 따라 요금이 나올 수 있으니 보호자 계정으로 관리해 주세요.
      </aside>
    </div>
  );
}

function Toggle({ label, desc, on, onChange, testId }: { label: string; desc: string; on: boolean; onChange(next: boolean): void; testId: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId}>
      <span className="toggle__text">
        <b>{label}</b>
        <small>{desc}</small>
      </span>
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
    </button>
  );
}
