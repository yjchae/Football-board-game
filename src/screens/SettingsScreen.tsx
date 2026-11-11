import { useState } from 'react';
import { testConnection } from '../ai/engine';
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

const SPEEDS = [
  { ms: 2200, label: '천천히' },
  { ms: 1400, label: '보통' },
  { ms: 700, label: '빠르게' },
];

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await testConnection(settings) });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings">
      <h2 className="hero-title">AI <span>연결</span></h2>

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
          <label className="field">
            <span>모델 이름</span>
            <input value={settings.geminiModel} onChange={(e) => update({ geminiModel: e.target.value.trim() || DEFAULT_SETTINGS.geminiModel })} />
          </label>
          <p className="muted small">
            Google AI Studio(aistudio.google.com)에서 본인 구글 계정으로 로그인 → “Get API key”로 키를 만들어 붙여 넣으세요.
            모델 이름이 바뀌었다면 AI Studio에서 사용 가능한 이름으로 바꿔 주세요.
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

      <section className="panel">
        <span className="field-label">중계 속도</span>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s.ms} className={settings.playbackMs === s.ms ? 'on' : ''} onClick={() => update({ playbackMs: s.ms })}>
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <aside className="notice-box">
        🔒 API 키는 이 기기의 브라우저에만 저장되고, AI 서버(구글/Anthropic)로만 직접 전송돼요.
        공용 컴퓨터에서는 사용 후 키를 지워 주세요. AI 사용량에 따라 요금이 나올 수 있으니 보호자 계정으로 관리해 주세요.
      </aside>
    </div>
  );
}
