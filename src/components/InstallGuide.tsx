import { useEffect, useState } from 'react';
import { detectPlatform, getInstallPrompt, isStandalone, onInstallAvailable, promptInstall } from '../pwa';

// ─────────────────────────────────────────────
// "홈 화면에 앱으로 설치" 안내
// - 안드로이드/PC 크롬: 설치 버튼 한 번
// - 아이폰/아이패드: 공유 → 홈 화면에 추가 (사파리는 자동 설치 버튼이 없음)
// ─────────────────────────────────────────────

const DISMISS_KEY = 'card-football-install-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallGuide({ variant }: { variant: 'banner' | 'panel' }) {
  const [canPrompt, setCanPrompt] = useState(Boolean(getInstallPrompt()));
  const [dismissed, setDismissed] = useState(readDismissed);
  const [installed, setInstalled] = useState(isStandalone());
  const platform = detectPlatform();

  useEffect(() => onInstallAvailable(() => setCanPrompt(true)), []);
  useEffect(() => {
    const done = () => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => window.removeEventListener('appinstalled', done);
  }, []);

  if (installed) {
    return variant === 'panel' ? (
      <section className="panel install">
        <b>📲 홈 화면 앱으로 실행 중</b>
        <p className="muted small">이 기기에 저장된 팀·선수·AI 키로 게임해요.</p>
      </section>
    ) : null;
  }
  if (variant === 'banner' && dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 저장 못 해도 이번 화면에서는 닫힘 */
    }
  };

  return (
    <section className={variant === 'banner' ? 'install-banner' : 'panel install'} data-testid={`install-${variant}`}>
      <div className="install__body">
        <b>📲 홈 화면에 앱으로 설치하기</b>
        {platform === 'ios' ? (
          <ol className="install__steps">
            <li><b>사파리</b>로 이 주소를 열어요</li>
            <li>아래(아이패드는 위) <b>공유 버튼 ⬆️</b>을 눌러요</li>
            <li><b>“홈 화면에 추가”</b>를 눌러요</li>
          </ol>
        ) : canPrompt ? (
          <p className="muted small">버튼 한 번으로 이 기기에 앱처럼 설치돼요.</p>
        ) : (
          <p className="muted small">
            크롬 메뉴(⋮) → <b>“홈 화면에 추가”</b> 또는 <b>“앱 설치”</b>를 눌러요.
          </p>
        )}
        {variant === 'panel' && (
          <p className="muted small">
            ⚠️ AI 키와 팀은 <b>설치한 앱 안에서</b> 다시 입력·생성해 주세요. 아이폰·아이패드는 사파리와 홈 화면 앱의 저장
            공간이 서로 달라요.
          </p>
        )}
      </div>
      <div className="install__actions">
        {canPrompt && platform !== 'ios' && (
          <button className="btn btn--primary" onClick={() => promptInstall().then((ok) => ok && setInstalled(true))}>
            설치하기
          </button>
        )}
        {variant === 'banner' && (
          <button className="icon-btn" onClick={dismiss} aria-label="안내 닫기">✕</button>
        )}
      </div>
    </section>
  );
}
