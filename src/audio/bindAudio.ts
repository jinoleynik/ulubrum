import type { Session } from '../session';
import type { Sfx } from './sfx';

/** Plays a sound for each game and combat event of a session. Returns an unsubscribe. */
export function bindAudio(session: Session, sfx: Sfx): () => void {
  const offGame = session.game.on((e) => {
    switch (e.kind) {
      case 'swapCommitted': return sfx.play('swap');
      case 'swapReverted': return sfx.play('swapFail');
      case 'waveDestroying': return sfx.play('match', e.wave);
      case 'tilesMarked': return sfx.play('bonusSpawn');
      case 'splash': return sfx.play('blast');
      case 'reshuffled': return sfx.play('reshuffle');
    }
  });
  const offSession = session.on((e) => {
    if (e.kind !== 'combat') return;
    const c = e.event;
    switch (c.kind) {
      case 'damage':
        return sfx.play(c.target === 'hero' ? 'hurt' : c.crit ? 'crit' : 'hit');
      case 'heal': return sfx.play('heal');
      case 'shield': return sfx.play('shield');
      case 'absorbed': return sfx.play('absorbed');
      case 'enemyDied': return sfx.play('enemyDie');
      case 'outcome': return sfx.play(c.outcome === 'won' ? 'win' : 'lose');
      case 'status':
        if (c.status === 'freeze') return sfx.play('freeze');
        if (c.target === 'hero' && ['stun', 'silence', 'weaken', 'poison'].includes(c.status)) return sfx.play('debuff');
    }
  });
  return () => {
    offGame();
    offSession();
  };
}
