/** End-of-game overlay with the final standings. */
import type { ClientAction } from '@shared/protocol';
import { store } from '../store';
import { money } from '../util';
import { button, clear, el } from './dom';
import { sfx } from '../audio/audio';

export class VictoryOverlay {
  readonly el: HTMLElement;
  private send: (action: ClientAction) => void;
  private onLeave: () => void;

  constructor(send: (action: ClientAction) => void, onLeave: () => void) {
    this.send = send;
    this.onLeave = onLeave;
    this.el = el('div', { class: 'victory' });
  }

  update(): void {
    const state = store.state;
    if (!state || state.phase !== 'finished') return;
    clear(this.el);

    const winner = store.player(state.winnerId);
    const standings = state.finalStandings ?? [];

    const list = el('div', { class: 'standings' });
    standings.forEach((row, index) => {
      const player = store.player(row.playerId);
      list.appendChild(
        el(
          'div',
          {
            class: `standing${row.rank === 1 ? ' first' : ''}`,
            style: { '--pc': player?.color ?? '#93a7c4', animationDelay: `${index * 90}ms` },
          },
          el('span', { class: 'rank' }, String(row.rank)),
          el(
            'div',
            { class: 'col', style: { gap: '0' } },
            el('b', null, row.name),
            el('span', { class: 'faint', style: { fontSize: '0.8em' } }, player?.bankrupt ? 'Bankrupt' : 'Survived'),
          ),
          el('span', { class: 'money' }, money(row.netWorth)),
        ),
      );
    });

    const card = el(
      'div',
      { class: 'panel victory-card' },
      el('div', { class: 'crown' }, '👑'),
      el('h1', null, winner ? `${winner.name} wins Aurora Bay` : 'Game over'),
      el(
        'p',
        { class: 'dim', style: { margin: '0' } },
        `${state.turn.round} round${state.turn.round === 1 ? '' : 's'} played · ${describeVictory(state.settings.victory.mode)}`,
      ),
      list,
      el(
        'div',
        { class: 'row', style: { justifyContent: 'center' } },
        store.isHost()
          ? button('btn primary', 'Play again', () => {
              sfx('click');
              this.send({ type: 'restart' });
            })
          : el('span', { class: 'hint' }, 'The host can start another game from here.'),
        button('btn ghost', 'Leave', () => {
          sfx('click');
          this.onLeave();
        }),
      ),
    );

    this.el.appendChild(card);
  }
}

function describeVictory(mode: string): string {
  switch (mode) {
    case 'wealth_target':
      return 'wealth target reached';
    case 'turn_limit':
      return 'round limit reached';
    default:
      return 'last player standing';
  }
}
