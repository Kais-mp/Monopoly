/** Pre-game lobby: seats, piece choice, house rules and the start button. */
import type { ClientAction } from '@shared/protocol';
import { PIECES, type PieceId } from '@shared/types';
import { MAX_NAME_LENGTH } from '@shared/protocol';
import { store } from '../store';
import { button, clear, el } from './dom';
import { renderPiecePicker } from './piecePicker';
import { SettingsEditor } from './settingsEditor';
import { toast } from './toasts';
import { sfx } from '../audio/audio';

export interface LobbyHandlers {
  send: (action: ClientAction) => void;
  onLeave: () => void;
}

export class LobbyScreen {
  readonly el: HTMLElement;
  private handlers: LobbyHandlers;
  private settings: SettingsEditor;
  private left: HTMLElement;
  private rightTop: HTMLElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;
  private lastRenderedVersion = -1;

  constructor(handlers: LobbyHandlers) {
    this.handlers = handlers;
    this.settings = new SettingsEditor((settings) => handlers.send({ type: 'update_settings', settings }));
    this.left = el('div', { class: 'lobby-left' });
    this.rightTop = el('div', { class: 'lobby-right' });
    this.chatLog = el('div', { class: 'chat-log scroll', style: { maxHeight: '150px' } });
    this.chatInput = el('input', {
      type: 'text',
      placeholder: 'Say something…',
      maxlength: 240,
      on: {
        keydown: ((ev: KeyboardEvent) => {
          if (ev.key !== 'Enter') return;
          const text = this.chatInput.value.trim();
          if (!text) return;
          this.handlers.send({ type: 'chat', text });
          this.chatInput.value = '';
        }) as (ev: never) => void,
      },
    });

    this.rightTop.appendChild(this.settings.el);
    this.rightTop.appendChild(
      el(
        'div',
        { class: 'panel', style: { padding: '12px' } },
        el('div', { class: 'tiny-label', style: { marginBottom: '8px' } }, 'Lobby chat'),
        this.chatLog,
        el('div', { class: 'chat-input-row', style: { marginTop: '8px' } }, this.chatInput),
      ),
    );

    this.el = el('div', { class: 'screen' }, el('div', { class: 'lobby' }, this.left, this.rightTop));
  }

  update(): void {
    const state = store.state;
    if (!state) return;
    this.settings.setSettings(state.settings, store.isHost());
    this.renderLeft();
    this.renderChat();
    this.lastRenderedVersion = state.version;
  }

  private renderChat(): void {
    clear(this.chatLog);
    for (const message of store.chat.slice(-40)) {
      if (message.kind === 'system') {
        this.chatLog.appendChild(el('div', { class: 'chat-msg system' }, message.text));
      } else {
        this.chatLog.appendChild(
          el(
            'div',
            { class: 'chat-msg' },
            el('span', { class: 'who', style: { color: message.color ?? '#e8f1ff' } }, `${message.playerName}: `),
            message.text,
          ),
        );
      }
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private renderLeft(): void {
    const state = store.state!;
    const me = store.me();
    const isHost = store.isHost();
    clear(this.left);

    /* Room code ---------------------------------------------------- */
    const share = async (link: boolean) => {
      const value = link ? `${location.origin}${location.pathname}?room=${state.roomCode}` : state.roomCode;
      try {
        await navigator.clipboard.writeText(value);
        toast(link ? 'Invite link copied.' : 'Room code copied.', 'good');
      } catch {
        toast(value, 'info', 6000);
      }
      sfx('click');
    };

    this.left.appendChild(
      el(
        'div',
        { class: 'panel roomcode' },
        el(
          'div',
          { class: 'col', style: { gap: '2px' } },
          el('span', { class: 'tiny-label' }, 'Room code'),
          el('span', { class: 'code' }, state.roomCode),
        ),
        el('span', { class: 'spacer' }),
        el(
          'div',
          { class: 'col', style: { gap: '6px' } },
          button('btn small', 'Copy code', () => void share(false)),
          button('btn small ghost', 'Copy invite link', () => void share(true)),
        ),
      ),
    );

    /* Seats -------------------------------------------------------- */
    const list = el('div', { class: 'panel player-list scroll' });
    list.appendChild(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'tiny-label' }, 'Players'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'tiny-label' }, `${state.players.length} / ${state.settings.maxPlayers}`),
      ),
    );

    for (const player of state.players) {
      const pieceName = PIECES.find((p) => p.id === player.piece)?.name ?? player.piece;
      const row = el(
        'div',
        {
          class: `player-row${player.id === store.youId ? ' you' : ''}`,
          style: { '--pc': player.color } as unknown as Record<string, string>,
        },
        el('span', { class: 'dot', style: { color: player.color } }),
        el(
          'div',
          { class: 'col', style: { gap: '0', minWidth: '0' } },
          el('span', { class: 'pname' }, player.name, player.id === store.youId ? ' (you)' : ''),
          el('span', { class: 'ppiece' }, pieceName),
        ),
        el('span', { class: 'spacer' }),
        player.isHost ? el('span', { class: 'pill warn' }, 'HOST') : null,
        !player.connected ? el('span', { class: 'pill bad' }, 'AWAY') : null,
        player.ready ? el('span', { class: 'pill good' }, 'READY') : el('span', { class: 'pill' }, 'WAITING'),
        isHost && player.id !== store.youId
          ? button('btn tiny bad', 'Kick', () => {
              this.handlers.send({ type: 'kick', playerId: player.id });
              sfx('click');
            })
          : null,
      );
      list.appendChild(row);
    }
    for (let i = state.players.length; i < state.settings.maxPlayers; i++) {
      list.appendChild(el('div', { class: 'empty-slot' }, 'Open seat'));
    }
    this.left.appendChild(list);

    /* Your seat ---------------------------------------------------- */
    if (me) {
      const nameInput = el('input', {
        type: 'text',
        value: me.name,
        maxlength: MAX_NAME_LENGTH,
        on: {
          change: () => {
            const value = nameInput.value.trim();
            if (value) this.handlers.send({ type: 'set_profile', name: value });
          },
        },
      });

      const pickerHost = el('div', { class: 'pieces' });
      const taken = state.players.filter((p) => p.id !== me.id).map((p) => p.piece as PieceId);
      renderPiecePicker(pickerHost, {
        selected: me.piece,
        taken,
        color: me.color,
        onSelect: (piece) => this.handlers.send({ type: 'set_profile', piece }),
      });

      this.left.appendChild(
        el(
          'div',
          { class: 'panel card', style: { padding: '16px' } },
          el('div', { class: 'field' }, el('label', null, 'Your name'), nameInput),
          el('div', { class: 'field' }, el('label', null, 'Your piece'), pickerHost),
          el(
            'div',
            { class: 'row' },
            button(
              `btn ${me.ready ? '' : 'good'} block`,
              me.ready ? 'Not ready' : "I'm ready",
              () => {
                this.handlers.send({ type: 'set_ready', ready: !me.ready });
                sfx('click');
              },
            ),
          ),
          isHost
            ? button(
                'btn primary block' + (canStart(state.players.length) ? ' pulse' : ''),
                startLabel(state.players.length),
                () => {
                  this.handlers.send({ type: 'start_game' });
                  sfx('click');
                },
                { disabled: !canStart(state.players.length) },
              )
            : el(
                'p',
                { class: 'hint', style: { textAlign: 'center', margin: '0' } },
                'Waiting for the host to start the game.',
              ),
          button('btn ghost small block', 'Leave game', () => this.handlers.onLeave()),
        ),
      );
    }
  }
}

function canStart(playerCount: number): boolean {
  return playerCount >= 2;
}

function startLabel(playerCount: number): string {
  return playerCount >= 2 ? 'Start game' : 'Need at least 2 players';
}
