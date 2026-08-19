/** Main menu, create-game and join-game screens. */
import { PIECES, type PieceId } from '@shared/types';
import { MAX_NAME_LENGTH } from '@shared/protocol';
import { button, clear, el } from './dom';
import { renderPiecePicker } from './piecePicker';
import { buildOptionsPanel } from './options';
import { prefs, setPref } from '../prefs';
import { sfx } from '../audio/audio';
import { probeRoom } from '../net/client';

type Mode = 'menu' | 'create' | 'join' | 'options';

export interface MenuHandlers {
  onCreate: (name: string, piece: PieceId) => void;
  onJoin: (code: string, name: string, piece: PieceId) => void;
  onQualityChange: () => void;
}

export class MenuScreen {
  readonly el: HTMLElement;
  private mode: Mode = 'menu';
  private piece: PieceId;
  private name: string;
  private error = '';
  private busy = false;
  private handlers: MenuHandlers;
  private prefillCode = '';

  constructor(handlers: MenuHandlers) {
    this.handlers = handlers;
    this.name = prefs.playerName;
    this.piece = PIECES[Math.floor(Math.random() * PIECES.length)]!.id;
    this.el = el('div', { class: 'screen' });
    // A room code in the URL (?room=ABC123) sends people straight to joining.
    const params = new URLSearchParams(location.search);
    const code = params.get('room') ?? params.get('r') ?? '';
    if (/^[A-Za-z0-9]{4,8}$/.test(code)) {
      this.prefillCode = code.toUpperCase();
      this.mode = 'join';
    }
    this.render();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  setError(message: string): void {
    this.error = message;
    this.busy = false;
    this.render();
  }

  private go(mode: Mode): void {
    this.mode = mode;
    this.error = '';
    sfx('click');
    this.render();
  }

  private nameField(): HTMLElement {
    const input = el('input', {
      type: 'text',
      value: this.name,
      maxlength: MAX_NAME_LENGTH,
      placeholder: 'Your name',
      autocomplete: 'nickname',
      on: {
        input: () => {
          this.name = input.value;
          setPref('playerName', input.value.trim().slice(0, MAX_NAME_LENGTH));
        },
      },
    });
    return el('div', { class: 'field' }, el('label', null, 'Display name'), input);
  }

  private pieceField(): HTMLElement {
    const host = el('div', { class: 'pieces' });
    renderPiecePicker(host, {
      selected: this.piece,
      taken: [],
      color: '#3ec7ff',
      onSelect: (piece) => {
        this.piece = piece;
        this.render();
      },
    });
    const blurb = PIECES.find((p) => p.id === this.piece)?.blurb ?? '';
    return el('div', { class: 'field' }, el('label', null, 'Your piece'), host, el('span', { class: 'hint' }, blurb));
  }

  private validName(): string | null {
    const trimmed = this.name.trim();
    if (trimmed.length < 1) return null;
    return trimmed.slice(0, MAX_NAME_LENGTH);
  }

  private render(): void {
    clear(this.el);
    const brand = el(
      'div',
      { class: 'brand' },
      el('h1', null, 'AURORA ', el('b', null, 'BAY')),
      el('p', null, 'A harbour city up for grabs · 2–6 players'),
    );

    switch (this.mode) {
      case 'menu':
        this.el.appendChild(
          el(
            'div',
            { class: 'col', style: { alignItems: 'center' } },
            brand,
            el(
              'div',
              { class: 'panel card' },
              button('btn primary block', 'Create a private game', () => this.go('create')),
              button('btn block', 'Join with a room code', () => this.go('join')),
              el('div', { class: 'row', style: { justifyContent: 'center' } }, button('btn ghost small', 'Options & accessibility', () => this.go('options'))),
              el(
                'p',
                { class: 'hint', style: { textAlign: 'center', margin: '4px 0 0' } },
                'Every roll, trade and payment is decided by the server. Nothing here can be edited in your browser.',
              ),
            ),
          ),
        );
        break;

      case 'create': {
        const submit = () => {
          const name = this.validName();
          if (!name) {
            this.setError('Pick a display name first.');
            return;
          }
          this.busy = true;
          this.error = '';
          this.render();
          this.handlers.onCreate(name, this.piece);
        };
        this.el.appendChild(
          el(
            'div',
            { class: 'col', style: { alignItems: 'center' } },
            brand,
            el(
              'div',
              { class: 'panel card' },
              el('h2', null, 'Create a game'),
              this.nameField(),
              this.pieceField(),
              el('div', { class: 'error-line' }, this.error),
              el(
                'div',
                { class: 'row' },
                button('btn ghost', 'Back', () => this.go('menu'), { disabled: this.busy }),
                el('span', { class: 'spacer' }),
                button('btn primary', this.busy ? 'Creating…' : 'Create room', submit, { disabled: this.busy }),
              ),
            ),
          ),
        );
        break;
      }

      case 'join': {
        const codeInput = el('input', {
          class: 'code-input',
          type: 'text',
          value: this.prefillCode,
          maxlength: 8,
          placeholder: 'CODE',
          autocomplete: 'off',
          on: {
            input: () => {
              codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
              this.prefillCode = codeInput.value;
            },
            keydown: ((ev: KeyboardEvent) => {
              if (ev.key === 'Enter') submit();
            }) as (ev: never) => void,
          },
        });

        const submit = async () => {
          const name = this.validName();
          const code = codeInput.value.trim().toUpperCase();
          if (!name) {
            this.setError('Pick a display name first.');
            return;
          }
          if (code.length < 4) {
            this.setError('Enter the room code your host shared.');
            return;
          }
          this.busy = true;
          this.error = '';
          this.render();
          const probe = await probeRoom(code);
          if (!probe.exists) {
            this.setError('No game found with that code.');
            return;
          }
          this.handlers.onJoin(code, name, this.piece);
        };

        this.el.appendChild(
          el(
            'div',
            { class: 'col', style: { alignItems: 'center' } },
            brand,
            el(
              'div',
              { class: 'panel card' },
              el('h2', null, 'Join a game'),
              el('div', { class: 'field' }, el('label', null, 'Room code'), codeInput),
              this.nameField(),
              this.pieceField(),
              el('span', { class: 'hint' }, 'If your piece is already taken, the host’s lobby will assign you another.'),
              el('div', { class: 'error-line' }, this.error),
              el(
                'div',
                { class: 'row' },
                button('btn ghost', 'Back', () => this.go('menu'), { disabled: this.busy }),
                el('span', { class: 'spacer' }),
                button('btn primary', this.busy ? 'Joining…' : 'Join game', () => void submit(), { disabled: this.busy }),
              ),
            ),
          ),
        );
        break;
      }

      case 'options':
        this.el.appendChild(
          el(
            'div',
            { class: 'col', style: { alignItems: 'center' } },
            brand,
            el(
              'div',
              { class: 'panel card' },
              el('h2', null, 'Options'),
              buildOptionsPanel(this.handlers.onQualityChange),
              button('btn block', 'Back', () => this.go('menu')),
            ),
          ),
        );
        break;
    }
  }
}
