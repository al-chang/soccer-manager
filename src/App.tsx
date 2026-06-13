import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { TitleScreen } from './ui/TitleScreen';
import { TeamSelect } from './ui/TeamSelect';
import { Shell } from './ui/Shell';
import { HomeScreen } from './ui/HomeScreen';
import { SquadScreen } from './ui/SquadScreen';
import { PlayerScreen } from './ui/PlayerScreen';
import { TacticsScreen } from './ui/TacticsScreen';
import { TransfersScreen } from './ui/TransfersScreen';
import { FixturesScreen } from './ui/FixturesScreen';
import { TableScreen } from './ui/TableScreen';
import { InboxScreen } from './ui/InboxScreen';
import { ClubScreen } from './ui/ClubScreen';
import { HistoryScreen } from './ui/HistoryScreen';
import { MatchScreen } from './ui/MatchScreen';

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const game = useGameStore((s) => s.game);
  const boot = useGameStore((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!game || screen === 'title') return <TitleScreen />;
  if (screen === 'team-select') return <TeamSelect />;

  return (
    <Shell>
      {screen === 'home' && <HomeScreen />}
      {screen === 'squad' && <SquadScreen />}
      {screen === 'player' && <PlayerScreen />}
      {screen === 'tactics' && <TacticsScreen />}
      {screen === 'transfers' && <TransfersScreen />}
      {screen === 'fixtures' && <FixturesScreen />}
      {screen === 'table' && <TableScreen />}
      {screen === 'inbox' && <InboxScreen />}
      {screen === 'club' && <ClubScreen />}
      {screen === 'history' && <HistoryScreen />}
      {screen === 'match' && <MatchScreen />}
    </Shell>
  );
}
