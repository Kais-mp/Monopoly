/**
 * Trade builder and offer inbox.
 *
 * The client only proposes; the server validates ownership, cash and the host's
 * trading rules again at both propose and accept time.
 */
import type { ClientAction } from '@shared/protocol';
import type { TradeOffer, TradeSide } from '@shared/types';
import { store } from '../store';
import { money } from '../util';
import { button, clear, el, hasFocusWithin } from './dom';
import { sfx } from '../audio/audio';
import { toast } from './toasts';

interface Draft {
  partnerId: string | null;
  give: TradeSide;
  receive: TradeSide;
  counterOf: string | null;
}

function emptySide(): TradeSide {
  return { money: 0, properties: [], escapeCards: 0 };
}

export class TradePanel {
  readonly el: HTMLElement;
  private send: (action: ClientAction) => void;
  private draft: Draft = { partnerId: null, give: emptySide(), receive: emptySide(), counterOf: null };

  constructor(send: (action: ClientAction) => void) {
    this.send = send;
    this.el = el('div', { class: 'col' });
  }

  reset(): void {
    this.draft = { partnerId: null, give: emptySide(), receive: emptySide(), counterOf: null };
  }

  /** Pre-loads the builder with the mirror image of an offer. */
  counter(offer: TradeOffer): void {
    this.draft = {
      partnerId: offer.fromId,
      give: { ...offer.request, properties: [...offer.request.properties] },
      receive: { ...offer.offer, properties: [...offer.offer.properties] },
      counterOf: offer.id,
    };
    this.update();
  }

  update(): void {
    // Never rebuild under the user's cursor while they are filling in an offer.
    if (hasFocusWithin(this.el)) return;
    const state = store.state;
    const me = store.me();
    clear(this.el);
    if (!state || !me) return;

    if (!state.settings.trading.enabled) {
      this.el.appendChild(el('p', { class: 'hint' }, 'Trading is switched off in this game’s house rules.'));
      return;
    }

    const partners = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
    if (partners.length === 0) {
      this.el.appendChild(el('p', { class: 'hint' }, 'There is nobody left to trade with.'));
      return;
    }

    if (!this.draft.partnerId || !partners.some((p) => p.id === this.draft.partnerId)) {
      this.draft.partnerId = partners[0]!.id;
    }
    const partner = store.player(this.draft.partnerId)!;

    const onlyOwnTurn = state.settings.trading.onlyOnYourTurn;
    const blocked = onlyOwnTurn && state.turn.playerId !== me.id;

    /* Offer inbox --------------------------------------------------- */
    const open = store.openTrades().filter((t) => t.fromId === me.id || t.toId === me.id);
    if (open.length > 0) {
      this.el.appendChild(el('div', { class: 'tiny-label' }, 'Open offers'));
      for (const offer of open) this.el.appendChild(this.offerCard(offer, me.id));
    }

    /* Builder ------------------------------------------------------- */
    this.el.appendChild(el('div', { class: 'tiny-label', style: { marginTop: '6px' } }, 'New offer'));

    const partnerSelect = el('select', {
      on: {
        change: () => {
          this.draft.partnerId = partnerSelect.value;
          this.draft.give.properties = [];
          this.draft.receive.properties = [];
          this.draft.counterOf = null;
          this.update();
        },
      },
    });
    for (const p of partners) {
      partnerSelect.appendChild(el('option', { value: p.id, selected: p.id === this.draft.partnerId }, p.name));
    }
    this.el.appendChild(el('div', { class: 'field' }, el('label', null, 'Trading with'), partnerSelect));

    const grid = el(
      'div',
      { class: 'trade-grid' },
      this.sideEditor('You give', me.id, this.draft.give),
      this.sideEditor(`${partner.name} gives`, partner.id, this.draft.receive),
    );
    this.el.appendChild(grid);

    const summaryValid = this.isMeaningful();
    this.el.appendChild(
      el(
        'div',
        { class: 'row', style: { marginTop: '6px' } },
        this.draft.counterOf ? el('span', { class: 'pill warn' }, 'COUNTER') : null,
        el('span', { class: 'spacer' }),
        button('btn ghost small', 'Clear', () => {
          this.reset();
          this.update();
        }),
        button(
          'btn primary',
          'Send offer',
          () => {
            sfx('click');
            this.send({
              type: 'propose_trade',
              toId: this.draft.partnerId!,
              offer: this.draft.give,
              request: this.draft.receive,
              ...(this.draft.counterOf ? { counterOf: this.draft.counterOf } : {}),
            });
            this.reset();
            this.update();
            toast('Offer sent.', 'good');
          },
          { disabled: blocked || !summaryValid },
        ),
      ),
    );

    if (blocked) {
      this.el.appendChild(el('p', { class: 'hint' }, 'This game only allows trading on your own turn.'));
    }
  }

  private isMeaningful(): boolean {
    const g = this.draft.give;
    const r = this.draft.receive;
    const total =
      g.money + g.properties.length + g.escapeCards + r.money + r.properties.length + r.escapeCards;
    return total > 0;
  }

  private sideEditor(title: string, playerId: string, side: TradeSide): HTMLElement {
    const state = store.state!;
    const player = store.player(playerId)!;
    const rules = state.settings.trading;
    const host = el('div', { class: 'trade-side' }, el('h4', null, title));

    if (rules.allowMoney) {
      const input = el('input', {
        type: 'number',
        min: 0,
        max: player.money,
        value: side.money,
        on: {
          input: () => {
            const v = Math.max(0, Math.min(player.money, Math.round(Number(input.value) || 0)));
            side.money = v;
          },
          blur: () => {
            input.value = String(side.money);
            this.update();
          },
        },
      });
      host.appendChild(el('div', { class: 'field' }, el('label', null, `Cash (has ${money(player.money)})`), input));
    }

    if (rules.allowEscapeCards && player.escapeCards > 0) {
      const input = el('input', {
        type: 'number',
        min: 0,
        max: player.escapeCards,
        value: side.escapeCards,
        on: {
          input: () => {
            side.escapeCards = Math.max(0, Math.min(player.escapeCards, Math.round(Number(input.value) || 0)));
          },
        },
      });
      host.appendChild(
        el('div', { class: 'field' }, el('label', null, `Release cards (${player.escapeCards})`), input),
      );
    }

    if (rules.allowProperties) {
      const list = el('div', { class: 'chk-list scroll' });
      const holdings = store.holdings(playerId);
      if (holdings.length === 0) {
        list.appendChild(el('span', { class: 'hint' }, 'No properties.'));
      }
      for (const { space, prop } of holdings) {
        const disabled = (prop.mortgaged && !rules.allowMortgaged) || prop.level > 0;
        const checked = side.properties.includes(space.id);
        const box = el('input', {
          type: 'checkbox',
          checked,
          disabled,
          on: {
            change: () => {
              const at = side.properties.indexOf(space.id);
              if (box.checked && at < 0) side.properties.push(space.id);
              else if (!box.checked && at >= 0) side.properties.splice(at, 1);
            },
          },
        });
        list.appendChild(
          el(
            'label',
            {
              class: `chk${disabled ? ' disabled' : ''}`,
              style: { '--gc': store.groupColor(space.group) },
              title: prop.level > 0 ? 'Sell the buildings before trading this.' : space.name,
            },
            box,
            el('span', null, space.name),
            prop.mortgaged ? el('span', { class: 'pill bad' }, 'M') : null,
          ),
        );
      }
      host.appendChild(el('div', { class: 'field' }, el('label', null, 'Properties'), list));
    }

    return host;
  }

  private offerCard(offer: TradeOffer, myId: string): HTMLElement {
    const from = store.player(offer.fromId);
    const to = store.player(offer.toId);
    const incoming = offer.toId === myId;

    const describe = (side: TradeSide): HTMLElement => {
      const parts: string[] = [];
      if (side.money > 0) parts.push(money(side.money));
      if (side.escapeCards > 0) parts.push(`${side.escapeCards} release card${side.escapeCards > 1 ? 's' : ''}`);
      for (const id of side.properties) parts.push(store.space(id)?.name ?? `#${id}`);
      return el('span', null, parts.length > 0 ? parts.join(', ') : 'nothing');
    };

    return el(
      'div',
      { class: 'offer-card' },
      el(
        'div',
        { class: 'heads' },
        el('span', { class: 'dot', style: { color: from?.color ?? '#fff' } }),
        el('span', null, from?.name ?? '?'),
        el('span', { class: 'faint' }, '→'),
        el('span', { class: 'dot', style: { color: to?.color ?? '#fff' } }),
        el('span', null, to?.name ?? '?'),
      ),
      el('div', { class: 'offer-line' }, el('b', null, `${from?.name ?? '?'} gives: `), describe(offer.offer)),
      el('div', { class: 'offer-line' }, el('b', null, `${from?.name ?? '?'} wants: `), describe(offer.request)),
      el(
        'div',
        { class: 'row' },
        incoming
          ? button('btn small good', 'Accept', () => {
              sfx('trade');
              this.send({ type: 'respond_trade', tradeId: offer.id, accept: true });
            })
          : null,
        incoming
          ? button('btn small bad', 'Decline', () => {
              sfx('click');
              this.send({ type: 'respond_trade', tradeId: offer.id, accept: false });
            })
          : null,
        incoming
          ? button('btn small', 'Counter', () => {
              sfx('click');
              this.counter(offer);
            })
          : null,
        !incoming
          ? button('btn small ghost', 'Cancel', () => {
              sfx('click');
              this.send({ type: 'cancel_trade', tradeId: offer.id });
            })
          : null,
      ),
    );
  }
}
