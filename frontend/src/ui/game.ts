/**
 * In-game interface: HUD, context actions, drawers and overlays.
 *
 * Every button here is a request. The server decides whether it happens, and
 * the UI only ever draws what the latest authoritative snapshot says.
 */
import type { ClientAction } from '@shared/protocol';
import type { EventCard, GameFx, Player } from '@shared/types';
import { store, type Drawer } from '../store';
import { money, shortMoney } from '../util';
import { prefs } from '../prefs';
import { button, clear, el, hasFocusWithin } from './dom';
import { buildDeed, levelPips } from './deed';
import { TradePanel } from './trade';
import { buildOptionsPanel } from './options';
import { SettingsEditor } from './settingsEditor';
import { toast } from './toasts';
import { sfx } from '../audio/audio';
import type { World } from '../three/world';

export interface GameHandlers {
  send: (action: ClientAction) => void;
  onLeave: () => void;
  onQualityChange: () => void;
}

export class GameUI {
  readonly el: HTMLElement;
  private handlers: GameHandlers;
  private world: World | null = null;

  private playersHost = el('div', { class: 'hud-players' });
  private centerHost = el('div', { class: 'hud-center' });
  private rightHost = el('div', { class: 'hud-right' });
  private selfHost = el('div', { class: 'self-bar' });
  private actionHost = el('div', { class: 'action-bar' });
  private camHost = el('div', { class: 'cam-cluster' });
  private drawerHost = el('div');
  private overlayHost = el('div');
  private tooltip = el('div', { class: 'space-tip hidden' });
  private bannerHost = el('div');

  private tradePanel: TradePanel;
  private rulesView: SettingsEditor;
  private chatLog = el('div', { class: 'chat-log scroll' });
  private chatInput: HTMLInputElement;
  private openDrawer: Drawer = null;
  private cardTimer = 0;
  private tickTimer = 0;
  private bidAmount: number | null = null;

  constructor(handlers: GameHandlers) {
    this.handlers = handlers;
    this.tradePanel = new TradePanel(handlers.send);
    this.rulesView = new SettingsEditor(() => undefined);
    this.chatInput = el('input', {
      type: 'text',
      placeholder: 'Message everyone…',
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

    this.el = el(
      'div',
      { class: 'game-root' },
      el('div', { class: 'hud-top' }, this.playersHost, this.centerHost, this.rightHost),
      this.selfHost,
      this.actionHost,
      this.camHost,
      this.drawerHost,
      this.overlayHost,
      this.tooltip,
      this.bannerHost,
    );

    this.renderCamCluster();
    this.tickTimer = window.setInterval(() => this.tick(), 250);
  }

  attachWorld(world: World): void {
    this.world = world;
  }

  destroy(): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.cardTimer);
  }

  /* ---------------------------------------------------------------- */
  /* Full refresh                                                      */
  /* ---------------------------------------------------------------- */

  update(): void {
    const state = store.state;
    if (!state) return;
    this.renderPlayers();
    this.renderCenter();
    this.renderRight();
    this.renderSelf();
    this.renderActions();
    this.renderDrawer();
    this.renderAuction();
    this.renderBanner();
  }

  private tick(): void {
    // Only the time-sensitive bits, so the rest of the UI stays stable.
    this.renderCenter();
    this.renderAuction();
  }

  /* ---------------------------------------------------------------- */
  /* HUD: players                                                      */
  /* ---------------------------------------------------------------- */

  private renderPlayers(): void {
    const state = store.state!;
    clear(this.playersHost);
    const order = state.order.length > 0 ? state.order : state.players.map((p) => p.id);
    const ordered = order
      .map((id) => state.players.find((p) => p.id === id))
      .filter((p): p is Player => Boolean(p));

    for (const player of ordered) {
      const active = state.turn.playerId === player.id;
      const flags = el('div', { class: 'flags' });
      if (player.isHost) flags.appendChild(el('span', { title: 'Host' }, '★'));
      if (!player.connected) flags.appendChild(el('span', { title: 'Disconnected' }, '⦸'));
      if (player.status === 'detained') flags.appendChild(el('span', { title: 'In detention' }, '⛓'));
      if (player.escapeCards > 0) flags.appendChild(el('span', { title: 'Release card' }, '🎫'));
      if (player.debt) flags.appendChild(el('span', { title: 'In debt' }, '⚠'));

      const holdings = store.holdings(player.id).length;
      this.playersHost.appendChild(
        el(
          'div',
          {
            class: `hud-player${active ? ' active' : ''}${player.bankrupt ? ' out' : ''}`,
            style: { '--pc': player.color },
            title: 'Click to focus the camera on this player',
            on: {
              click: () => {
                sfx('click');
                this.world?.focusPlayer(player.id);
                store.setInspectPlayer(player.id);
                this.openDrawer = 'holdings';
                store.setDrawer('holdings');
              },
            },
          },
          el('span', { class: 'dot', style: { color: player.color } }),
          el(
            'div',
            { class: 'col', style: { gap: '0', minWidth: '0' } },
            el('span', { class: 'nm' }, player.name, player.id === store.youId ? ' (you)' : ''),
            el(
              'span',
              { class: 'sub' },
              player.bankrupt ? 'Bankrupt' : `${holdings} propert${holdings === 1 ? 'y' : 'ies'}`,
            ),
          ),
          el(
            'div',
            { class: 'col', style: { gap: '1px', alignItems: 'flex-end' } },
            el('span', { class: 'amt' }, player.bankrupt ? '—' : shortMoney(player.money)),
            flags,
          ),
        ),
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* HUD: turn banner                                                  */
  /* ---------------------------------------------------------------- */

  private renderCenter(): void {
    const state = store.state;
    if (!state) return;
    clear(this.centerHost);
    const active = store.activePlayer();
    const mine = store.isMyTurn();

    let remaining = '';
    if (state.turn.deadline && state.settings.turnTimeLimit > 0) {
      const secondsLeft = Math.ceil((state.turn.deadline - Date.now()) / 1000);
      if (secondsLeft >= 0 && secondsLeft <= state.settings.turnTimeLimit + 5) {
        remaining = `${secondsLeft}s`;
      }
    }

    this.centerHost.appendChild(
      el(
        'div',
        { class: 'turn-banner' },
        active ? el('span', { class: 'dot', style: { color: active.color } }) : null,
        el('span', { class: 'who' }, mine ? 'Your turn' : active ? `${active.name}’s turn` : 'Waiting'),
        el('span', { class: 'phase' }, phaseLabel(state.turn.phase)),
        remaining ? el('span', { class: 'clock' }, remaining) : null,
      ),
    );
    this.centerHost.appendChild(
      el(
        'div',
        { class: 'round-chip' },
        `Round ${state.turn.round}`,
        state.pot > 0 ? ` · Pot ${money(state.pot)}` : '',
        state.settings.victory.mode === 'turn_limit' ? ` / ${state.settings.victory.turnLimit}` : '',
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* HUD: right icon bar                                               */
  /* ---------------------------------------------------------------- */

  private renderRight(): void {
    clear(this.rightHost);
    const incoming = store.incomingTrades().length;
    const bar = el('div', { class: 'icon-bar' });

    const iconButton = (
      label: string,
      title: string,
      drawer: Drawer,
      badge?: number,
    ): HTMLElement => {
      const node = button(`icon-btn${store.drawer === drawer ? ' on' : ''}`, label, () => {
        sfx('click');
        store.setDrawer(drawer);
      }, { title });
      if (badge && badge > 0) node.appendChild(el('span', { class: 'badge' }, String(badge)));
      return node;
    };

    bar.appendChild(iconButton('💬', 'Chat', 'chat', store.unreadChat));
    bar.appendChild(iconButton('🤝', 'Trade', 'trade', incoming));
    bar.appendChild(iconButton('🏙', 'Properties', 'holdings'));
    bar.appendChild(iconButton('📋', 'House rules', 'rules'));
    bar.appendChild(iconButton('⚙', 'Options', 'settings'));
    this.rightHost.appendChild(bar);
  }

  /* ---------------------------------------------------------------- */
  /* Self bar                                                          */
  /* ---------------------------------------------------------------- */

  private renderSelf(): void {
    const me = store.me();
    clear(this.selfHost);
    if (!me) {
      this.selfHost.classList.add('hidden');
      return;
    }
    this.selfHost.classList.remove('hidden');
    this.selfHost.style.setProperty('--pc', me.color);
    const holdings = store.holdings(me.id);

    this.selfHost.appendChild(el('span', { class: 'tiny-label' }, me.name));
    this.selfHost.appendChild(el('span', { class: 'cash' }, money(me.money)));
    this.selfHost.appendChild(
      el(
        'div',
        { class: 'meta' },
        el('span', null, `Net ${shortMoney(me.netWorth)}`),
        el('span', null, `${holdings.length} deeds`),
        me.escapeCards > 0 ? el('span', null, `${me.escapeCards} release`) : null,
      ),
    );
    if (me.debt) {
      this.selfHost.appendChild(
        el('span', { class: 'pill bad' }, `Owes ${money(me.debt.amount)}`),
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Context action bar                                                */
  /* ---------------------------------------------------------------- */

  private renderActions(): void {
    const state = store.state!;
    const me = store.me();
    clear(this.actionHost);
    this.actionHost.classList.remove('waiting');

    if (state.phase !== 'playing' || !me) {
      this.actionHost.classList.add('hidden');
      return;
    }
    this.actionHost.classList.remove('hidden');

    const send = (action: ClientAction) => {
      sfx('click');
      this.handlers.send(action);
    };
    const turn = state.turn;
    const mine = turn.playerId === me.id;

    // An open auction takes over the screen, so the bar steps aside.
    if (state.auction) {
      this.actionHost.classList.add('hidden');
      return;
    }

    if (me.bankrupt) {
      this.actionHost.appendChild(el('span', { class: 'prompt' }, 'You are out of the game — enjoy the show.'));
      return;
    }

    if (!mine) {
      const active = store.activePlayer();
      this.actionHost.classList.add('waiting');
      this.actionHost.appendChild(
        el('span', { class: 'prompt' }, 'Waiting for ', el('b', null, active?.name ?? 'the next player'), '…'),
      );
      if (state.settings.trading.enabled && !state.settings.trading.onlyOnYourTurn) {
        this.actionHost.appendChild(
          button('btn small', 'Propose a trade', () => {
            sfx('click');
            store.setDrawer('trade');
          }),
        );
      }
      return;
    }

    switch (turn.phase) {
      case 'awaiting_roll': {
        const extra = turn.doublesCount > 0;
        this.actionHost.appendChild(
          el(
            'span',
            { class: 'prompt' },
            extra ? 'Doubles! ' : '',
            extra ? el('b', null, 'Roll again') : 'Your move — roll the dice.',
          ),
        );
        this.actionHost.appendChild(
          button('btn primary pulse', '🎲 Roll dice', () => send({ type: 'roll_dice' })),
        );
        break;
      }

      case 'detained': {
        const rules = state.settings.detention;
        this.actionHost.appendChild(
          el(
            'span',
            { class: 'prompt' },
            'You are held in the yard. ',
            el('b', null, `${me.detentionTurns} turn${me.detentionTurns === 1 ? '' : 's'} left`),
          ),
        );
        if (rules.escapeWithDoubles) {
          this.actionHost.appendChild(
            button('btn primary', '🎲 Roll for doubles', () => send({ type: 'roll_for_escape' })),
          );
        }
        if (rules.payToLeaveAllowed) {
          this.actionHost.appendChild(
            button(
              'btn warn',
              `Pay ${money(state.settings.money.detentionFee)}`,
              () => send({ type: 'pay_detention_fee' }),
              { disabled: me.money < state.settings.money.detentionFee },
            ),
          );
        }
        if (rules.cardsAllowed && me.escapeCards > 0) {
          this.actionHost.appendChild(
            button('btn good', 'Use release card', () => send({ type: 'use_escape_card' })),
          );
        }
        if (!rules.escapeWithDoubles && !rules.payToLeaveAllowed) {
          this.actionHost.appendChild(button('btn', 'End turn', () => send({ type: 'end_turn' })));
        }
        break;
      }

      case 'awaiting_purchase': {
        const spaceId = turn.pendingPurchase;
        const space = spaceId !== null ? store.space(spaceId) : null;
        const price = space?.price ?? 0;
        this.actionHost.appendChild(
          el(
            'span',
            { class: 'prompt' },
            el('b', null, space?.name ?? 'This space'),
            ' is unowned. ',
            store.groupColor(space?.group) ? '' : '',
          ),
        );
        this.actionHost.appendChild(
          button('btn good', `Buy for ${money(price)}`, () => send({ type: 'buy' }), {
            disabled: me.money < price,
          }),
        );
        this.actionHost.appendChild(
          button(
            'btn',
            state.settings.property.auctionsEnabled ? 'Pass — send to auction' : 'Pass',
            () => send({ type: 'decline_purchase' }),
          ),
        );
        if (spaceId !== null) {
          this.actionHost.appendChild(
            button('btn ghost small', 'Details', () => {
              sfx('click');
              store.setInspect(spaceId);
            }),
          );
        }
        break;
      }

      case 'settling_debt': {
        const owed = me.debt?.amount ?? 0;
        const creditor = me.debt?.creditorId ? store.playerName(me.debt.creditorId) : 'the bank';
        this.actionHost.appendChild(
          el(
            'span',
            { class: 'prompt' },
            'You owe ',
            el('b', null, money(owed)),
            ` to ${creditor}. Raise the cash by mortgaging or selling buildings.`,
          ),
        );
        this.actionHost.appendChild(
          button('btn', 'Manage property', () => {
            sfx('click');
            store.setDrawer('holdings');
          }),
        );
        if (state.settings.trading.enabled) {
          this.actionHost.appendChild(
            button('btn small', 'Trade', () => {
              sfx('click');
              store.setDrawer('trade');
            }),
          );
        }
        this.actionHost.appendChild(
          button('btn bad small', 'Declare bankruptcy', () => {
            if (!confirm('Declare bankruptcy and leave the game?')) return;
            send({ type: 'declare_bankruptcy' });
          }),
        );
        break;
      }

      case 'awaiting_end': {
        this.actionHost.appendChild(el('span', { class: 'prompt' }, 'Anything else before you finish?'));
        if (state.settings.trading.enabled) {
          this.actionHost.appendChild(
            button('btn small', 'Trade', () => {
              sfx('click');
              store.setDrawer('trade');
            }),
          );
        }
        this.actionHost.appendChild(
          button('btn small', 'Build & mortgage', () => {
            sfx('click');
            store.setDrawer('holdings');
          }),
        );
        this.actionHost.appendChild(button('btn primary', 'End turn', () => send({ type: 'end_turn' })));
        break;
      }

      case 'resolving':
        this.actionHost.classList.add('waiting');
        this.actionHost.appendChild(el('span', { class: 'prompt' }, 'Resolving…'));
        break;

      default:
        this.actionHost.classList.add('hidden');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Camera cluster                                                    */
  /* ---------------------------------------------------------------- */

  private renderCamCluster(): void {
    clear(this.camHost);
    const bar = el(
      'div',
      { class: 'icon-bar' },
      button('icon-btn', '⟲', () => this.world?.orbit(0.35), { title: 'Rotate left' }),
      button('icon-btn', '⟳', () => this.world?.orbit(-0.35), { title: 'Rotate right' }),
    );
    const bar2 = el(
      'div',
      { class: 'icon-bar' },
      button('icon-btn', '＋', () => this.world?.zoom(-0.18), { title: 'Zoom in' }),
      button('icon-btn', '－', () => this.world?.zoom(0.18), { title: 'Zoom out' }),
      button('icon-btn', '⌂', () => this.world?.resetCamera(), { title: 'Reset camera' }),
    );
    this.camHost.appendChild(bar);
    this.camHost.appendChild(bar2);
  }

  /* ---------------------------------------------------------------- */
  /* Drawers                                                           */
  /* ---------------------------------------------------------------- */

  private renderDrawer(): void {
    const drawer = store.drawer;
    if (drawer !== this.openDrawer) {
      this.openDrawer = drawer;
      clear(this.drawerHost);
      if (drawer === null) return;
      this.drawerHost.appendChild(this.buildDrawer(drawer));
    }
    // Live sections still refresh while open.
    if (drawer === 'chat') this.renderChatLog();
    if (drawer === 'trade') this.tradePanel.update();
    if (drawer === 'holdings') this.renderHoldings();
    if (drawer === 'rules') this.rulesView.setSettings(store.state!.settings, false);
  }

  private holdingsBody = el('div', { class: 'col' });

  private buildDrawer(drawer: Drawer): HTMLElement {
    const close = button('close-x', '✕', () => {
      sfx('click');
      store.setDrawer(null);
    });

    let title = '';
    let body: HTMLElement;
    let foot: HTMLElement | null = null;

    switch (drawer) {
      case 'chat':
        title = 'Chat & log';
        body = this.chatLog;
        foot = el('div', { class: 'chat-input-row' }, this.chatInput);
        store.unreadChat = 0;
        break;
      case 'trade':
        title = 'Trading';
        body = this.tradePanel.el;
        this.tradePanel.update();
        break;
      case 'holdings':
        title = 'Properties';
        body = this.holdingsBody;
        break;
      case 'rules':
        title = 'House rules';
        body = this.rulesView.el;
        break;
      case 'settings':
      default:
        title = 'Options';
        body = buildOptionsPanel(this.handlers.onQualityChange);
        foot = el(
          'div',
          { class: 'row' },
          button('btn ghost small block', 'Leave game', () => this.handlers.onLeave()),
        );
        break;
    }

    return el(
      'div',
      { class: 'drawer' },
      el('div', { class: 'drawer-head' }, el('h3', null, title), el('span', { class: 'spacer' }), close),
      drawer === 'rules' || drawer === 'trade' || drawer === 'holdings' || drawer === 'settings'
        ? el('div', { class: 'drawer-body scroll' }, body)
        : el('div', { class: 'drawer-body scroll' }, body),
      foot ? el('div', { class: 'drawer-foot' }, foot) : null,
    );
  }

  private renderChatLog(): void {
    if (hasFocusWithin(this.chatLog)) return;
    clear(this.chatLog);
    for (const message of store.chat) {
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

  private renderHoldings(): void {
    const state = store.state!;
    const focusId = store.inspectPlayer ?? store.youId;
    const focus = store.player(focusId);
    clear(this.holdingsBody);

    // Player switcher so you can inspect anyone's portfolio.
    const tabs = el('div', { class: 'row wrap' });
    for (const player of state.players) {
      tabs.appendChild(
        button(
          `preset-chip${player.id === focusId ? ' active' : ''}`,
          player.name,
          () => {
            sfx('hover');
            store.setInspectPlayer(player.id);
            store.setDrawer('holdings');
            store.drawer = 'holdings';
            this.renderHoldings();
          },
        ),
      );
    }
    this.holdingsBody.appendChild(tabs);

    if (store.inspectSpace !== null) {
      this.holdingsBody.appendChild(buildDeed(store.inspectSpace, { send: this.handlers.send }));
      this.holdingsBody.appendChild(
        button('btn ghost small', 'Back to the list', () => {
          store.setInspect(null);
          store.drawer = 'holdings';
          this.renderHoldings();
        }),
      );
      return;
    }

    if (!focus) return;
    const holdings = store.holdings(focus.id);
    this.holdingsBody.appendChild(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'dot', style: { color: focus.color } }),
        el('b', null, focus.name),
        el('span', { class: 'spacer' }),
        el('span', { class: 'money' }, money(focus.money)),
      ),
    );
    this.holdingsBody.appendChild(
      el('span', { class: 'hint' }, `Net worth ${money(focus.netWorth)} · ${holdings.length} deeds`),
    );

    if (holdings.length === 0) {
      this.holdingsBody.appendChild(el('p', { class: 'hint' }, 'No properties yet.'));
      return;
    }

    // Group the deeds the way the board does.
    const byGroup = new Map<string, typeof holdings>();
    for (const item of holdings) {
      const key = item.space.group ?? item.space.type;
      const list = byGroup.get(key) ?? [];
      list.push(item);
      byGroup.set(key, list);
    }

    for (const [key, items] of byGroup) {
      const group = store.group(key);
      const total = state.board.filter((b) => (b.group ?? b.type) === key).length;
      const block = el('div', { class: 'group-block' });
      block.appendChild(
        el(
          'div',
          { class: 'group-head', style: { '--gc': group?.color ?? '#5a7290' } },
          group?.name ?? key,
          el('span', { class: 'spacer' }),
          `${items.length}/${total}`,
        ),
      );
      for (const { space, prop } of items) {
        block.appendChild(
          el(
            'div',
            {
              class: `prop-row${prop.mortgaged ? ' mortgaged' : ''}`,
              on: {
                click: () => {
                  sfx('click');
                  store.setInspect(space.id);
                  store.drawer = 'holdings';
                  this.world?.focusOnSpace(space.id);
                  this.renderHoldings();
                },
              },
            },
            el(
              'span',
              { class: 'nm' },
              space.name,
              space.type === 'property'
                ? levelPips(prop.level, state.settings.property.maxLevel, state.settings.property.towerEnabled)
                : null,
            ),
            el('span', { class: 'money faint' }, prop.mortgaged ? 'mortgaged' : money(space.price ?? 0)),
          ),
        );
      }
      this.holdingsBody.appendChild(block);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Auction overlay                                                   */
  /* ---------------------------------------------------------------- */

  private auctionNode: HTMLElement | null = null;

  private renderAuction(): void {
    const state = store.state;
    const auction = state?.auction ?? null;
    if (!auction || !state) {
      if (this.auctionNode) {
        this.auctionNode.remove();
        this.auctionNode = null;
        this.bidAmount = null;
      }
      return;
    }

    const me = store.me();
    const space = store.space(auction.spaceId);
    const total = state.settings.property.auctionSeconds * 1000;
    const left = Math.max(0, auction.endsAt - Date.now());
    const step = state.settings.property.auctionMinIncrement;
    const minBid = auction.currentBid + step;
    const inPool = !!me && auction.activeBidders.includes(me.id) && !auction.passed.includes(me.id);

    if (this.bidAmount === null || this.bidAmount < minBid) this.bidAmount = minBid;

    const node = el(
      'div',
      { class: 'panel auction' },
      el('span', { class: 'tiny-label', style: { textAlign: 'center' } }, 'Auction'),
      el('h2', null, space?.name ?? 'Property'),
      el(
        'div',
        { class: 'row', style: { justifyContent: 'center' } },
        auction.highBidderId
          ? el(
              'span',
              { class: 'hint' },
              'High bid by ',
              el('b', { style: { color: store.playerColor(auction.highBidderId) } }, store.playerName(auction.highBidderId)),
            )
          : el('span', { class: 'hint' }, 'No bids yet'),
      ),
      el('div', { class: 'bid' }, money(auction.currentBid)),
      el('div', { class: 'timer' }, el('i', { style: { width: `${Math.min(100, (left / Math.max(1, total)) * 100)}%` } })),
      el(
        'div',
        { class: 'bidder-list' },
        ...state.players
          .filter((p) => auction.activeBidders.includes(p.id))
          .map((p) =>
            el(
              'span',
              {
                class: `bidder${auction.passed.includes(p.id) ? ' passed' : ''}${auction.highBidderId === p.id ? ' high' : ''}`,
                style: { borderColor: p.color },
              },
              p.name,
            ),
          ),
      ),
    );

    if (me && inPool && !me.bankrupt) {
      const bidInput = el('input', {
        type: 'number',
        min: minBid,
        max: me.money,
        step,
        value: this.bidAmount,
        on: {
          input: () => {
            this.bidAmount = Math.max(minBid, Math.round(Number(bidInput.value) || minBid));
          },
        },
      });
      const quick = el('div', { class: 'bid-grid' });
      for (const delta of [step, step * 5, step * 10, 0]) {
        const amount = delta === 0 ? me.money : auction.currentBid + delta;
        quick.appendChild(
          button(
            'btn small',
            delta === 0 ? 'All in' : `+${money(delta)}`,
            () => {
              sfx('bid');
              this.handlers.send({ type: 'bid', amount });
            },
            { disabled: amount > me.money || amount < minBid },
          ),
        );
      }
      node.appendChild(el('div', { class: 'field' }, el('label', null, `Your bid (min ${money(minBid)})`), bidInput));
      node.appendChild(quick);
      node.appendChild(
        el(
          'div',
          { class: 'row' },
          button('btn bad', 'Pass', () => {
            sfx('click');
            this.handlers.send({ type: 'auction_pass' });
          }),
          el('span', { class: 'spacer' }),
          button(
            'btn primary',
            'Place bid',
            () => {
              sfx('bid');
              this.handlers.send({ type: 'bid', amount: this.bidAmount ?? minBid });
            },
            { disabled: (this.bidAmount ?? 0) > me.money },
          ),
        ),
      );
    } else {
      node.appendChild(
        el('p', { class: 'hint', style: { textAlign: 'center' } }, me ? 'You are out of this auction.' : 'Watching.'),
      );
    }

    // Rebuild in place, but never while the bid box has focus.
    if (this.auctionNode && hasFocusWithin(this.auctionNode)) {
      const bar = this.auctionNode.querySelector('.timer i') as HTMLElement | null;
      if (bar) bar.style.width = `${Math.min(100, (left / Math.max(1, total)) * 100)}%`;
      const bid = this.auctionNode.querySelector('.bid');
      if (bid) bid.textContent = money(auction.currentBid);
      return;
    }
    this.auctionNode?.remove();
    this.auctionNode = node;
    this.overlayHost.appendChild(node);
  }

  /* ---------------------------------------------------------------- */
  /* Event card modal                                                  */
  /* ---------------------------------------------------------------- */

  showCard(card: EventCard, playerName: string): void {
    window.clearTimeout(this.cardTimer);
    this.overlayHost.querySelector('.card-modal')?.remove();
    const node = el(
      'div',
      { class: 'card-modal' },
      el('div', { class: 'cat' }, card.category),
      el('h3', null, card.title),
      el('p', null, card.text),
      el('p', { class: 'hint', style: { marginTop: '10px' } }, `Drawn by ${playerName}`),
    );
    this.overlayHost.appendChild(node);
    const dwell = prefs.reducedMotion ? 1400 : 2600;
    this.cardTimer = window.setTimeout(() => node.remove(), dwell);
  }

  /* ---------------------------------------------------------------- */
  /* Space tooltip + inspection                                        */
  /* ---------------------------------------------------------------- */

  showTooltip(spaceId: number | null, x: number, y: number): void {
    if (!prefs.showTooltips || spaceId === null) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const space = store.space(spaceId);
    if (!space) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const prop = store.property(spaceId);
    const owner = prop?.ownerId ? store.player(prop.ownerId) : null;
    clear(this.tooltip);
    this.tooltip.appendChild(el('b', null, space.name));
    if (space.price !== undefined) {
      this.tooltip.appendChild(
        el('div', null, owner ? `Owned by ${owner.name}` : `Unowned · ${money(space.price)}`),
      );
      if (prop && prop.level > 0) this.tooltip.appendChild(el('div', { class: 'faint' }, `Level ${prop.level}`));
      if (prop?.mortgaged) this.tooltip.appendChild(el('div', { class: 'faint' }, 'Mortgaged'));
    } else if (space.amount !== undefined) {
      this.tooltip.appendChild(el('div', null, money(space.amount)));
    } else if (space.flavor) {
      this.tooltip.appendChild(el('div', { class: 'faint' }, space.flavor));
    }
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  inspectSpace(spaceId: number): void {
    store.setInspect(spaceId);
    store.drawer = 'holdings';
    store.emit();
    this.openDrawer = null;
    this.renderDrawer();
  }

  /* ---------------------------------------------------------------- */
  /* Connection banner                                                 */
  /* ---------------------------------------------------------------- */

  private renderBanner(): void {
    clear(this.bannerHost);
    if (store.connection === 'reconnecting') {
      this.bannerHost.appendChild(el('div', { class: 'conn-banner' }, 'Connection lost — reconnecting…'));
    } else if (store.connection === 'closed') {
      this.bannerHost.appendChild(el('div', { class: 'conn-banner' }, 'Disconnected.'));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Effect hooks                                                      */
  /* ---------------------------------------------------------------- */

  present(fx: GameFx): void {
    switch (fx.t) {
      case 'card':
        this.showCard(fx.card, store.playerName(fx.playerId));
        break;
      case 'rent': {
        const payer = store.playerName(fx.fromId);
        const owner = store.playerName(fx.toId);
        toast(`${payer} paid ${owner} ${money(fx.amount)} rent`, 'warn');
        break;
      }
      case 'bankrupt':
        toast(`${store.playerName(fx.playerId)} is bankrupt.`, 'bad', 4200);
        break;
      case 'auction_won':
        toast(
          `${store.playerName(fx.playerId)} won ${store.space(fx.spaceId)?.name ?? 'the auction'} for ${money(fx.amount)}`,
          'good',
        );
        break;
      case 'trade':
        toast(`${store.playerName(fx.fromId)} and ${store.playerName(fx.toId)} agreed a trade.`, 'good');
        break;
      default:
        break;
    }
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'awaiting_roll':
      return 'to roll';
    case 'resolving':
      return 'resolving';
    case 'awaiting_purchase':
      return 'deciding';
    case 'auction':
      return 'auction';
    case 'awaiting_end':
      return 'finishing up';
    case 'settling_debt':
      return 'settling debt';
    case 'detained':
      return 'detained';
    case 'game_over':
      return 'game over';
    default:
      return '';
  }
}
