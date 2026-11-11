import { useEffect, useState } from 'react';
import { MatchScreen } from './screens/MatchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TeamsScreen } from './screens/TeamsScreen';
import { engineLabel } from './ai/engine';
import { InstallGuide } from './components/InstallGuide';
import { onSaveStatus } from './store/storage';
import { useStore } from './store/useStore';

type Screen = 'teams' | 'match' | 'settings';

const NAV: { id: Screen; icon: string; label: string }[] = [
  { id: 'teams', icon: '🃏', label: '팀 관리' },
  { id: 'match', icon: '⚽', label: '경기' },
  { id: 'settings', icon: '⚙️', label: 'AI 설정' },
];

/** 저장된 데이터를 다 불러온 뒤에 화면을 그린다 (불러오기 전에 수정하면 덮어써지는 문제 방지) */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => {
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}

function useSaveWarning(): [string | null, () => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onSaveStatus(setMessage), []);
  return [message, () => setMessage(null)];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('teams');
  const settings = useStore((s) => s.settings);
  const hydrated = useHydrated();
  const [saveWarning, dismissSaveWarning] = useSaveWarning();

  if (!hydrated) {
    return (
      <div className="splash">
        <span className="ball-spin">⚽</span>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo__ball">⚽</span>
          <span className="logo__text">카드 풋볼<em>LEAGUE</em></span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={screen === n.id ? 'on' : ''} onClick={() => setScreen(n.id)}>
              <span>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <span className="engine-tag" title="현재 경기 엔진">{engineLabel(settings)}</span>
      </header>

      <main className="main">
        {saveWarning && (
          <div className="save-warning" role="alert" data-testid="save-warning">
            ⚠️ {saveWarning}
            <button className="icon-btn" onClick={dismissSaveWarning} aria-label="닫기">✕</button>
          </div>
        )}
        <InstallGuide variant="banner" />
        {screen === 'teams' && <TeamsScreen />}
        {screen === 'match' && <MatchScreen goTeams={() => setScreen('teams')} />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
