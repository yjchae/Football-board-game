import { useState } from 'react';
import { MatchScreen } from './screens/MatchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TeamsScreen } from './screens/TeamsScreen';
import { engineLabel } from './ai/engine';
import { InstallGuide } from './components/InstallGuide';
import { useStore } from './store/useStore';

type Screen = 'teams' | 'match' | 'settings';

const NAV: { id: Screen; icon: string; label: string }[] = [
  { id: 'teams', icon: '🃏', label: '팀 관리' },
  { id: 'match', icon: '⚽', label: '경기' },
  { id: 'settings', icon: '⚙️', label: 'AI 설정' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('teams');
  const settings = useStore((s) => s.settings);

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
        <InstallGuide variant="banner" />
        {screen === 'teams' && <TeamsScreen />}
        {screen === 'match' && <MatchScreen goTeams={() => setScreen('teams')} />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
