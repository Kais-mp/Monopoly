/**
 * Host rules editor.
 *
 * Everything the host can bend lives here, grouped into tabs. Nothing is
 * hard-coded on the client: the editor writes a full `GameSettings` object and
 * the server clamps and validates it before it becomes real.
 */
import type { EventCategory, GameSettings, RulePreset } from '@shared/types';
import { button, clear, el, hasFocusWithin } from './dom';
import { sfx } from '../audio/audio';
import { apiUrl } from '../net/endpoint';

type Tab =
  | 'money'
  | 'dice'
  | 'property'
  | 'detention'
  | 'reststop'
  | 'events'
  | 'trading'
  | 'bankruptcy'
  | 'victory'
  | 'game';

const TABS: { id: Tab; label: string }[] = [
  { id: 'money', label: 'Money' },
  { id: 'dice', label: 'Dice' },
  { id: 'property', label: 'Property' },
  { id: 'detention', label: 'Detention' },
  { id: 'reststop', label: 'Rest Stop' },
  { id: 'events', label: 'Events' },
  { id: 'trading', label: 'Trading' },
  { id: 'bankruptcy', label: 'Bankruptcy' },
  { id: 'victory', label: 'Victory' },
  { id: 'game', label: 'Game' },
];

const CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: 'fortune', label: 'Fortune' },
  { id: 'setback', label: 'Setback' },
  { id: 'movement', label: 'Movement' },
  { id: 'civic', label: 'Civic' },
  { id: 'chaos', label: 'Chaos' },
];

export class SettingsEditor {
  readonly el: HTMLElement;
  private tabsHost: HTMLElement;
  private body: HTMLElement;
  private presetHost: HTMLElement;
  private footHost: HTMLElement;
  private tab: Tab = 'money';
  private draft: GameSettings | null = null;
  private editable = false;
  private presets: RulePreset[] = [];
  private sendTimer = 0;
  private quietUntil = 0;
  private onCommit: (settings: GameSettings) => void;

  constructor(onCommit: (settings: GameSettings) => void) {
    this.onCommit = onCommit;
    this.presetHost = el('div', { class: 'preset-bar' });
    this.tabsHost = el('div', { class: 'settings-tabs' });
    this.body = el('div', { class: 'settings-body scroll' });
    this.footHost = el('div', { class: 'settings-foot' });
    this.el = el(
      'div',
      { class: 'panel settings' },
      el(
        'div',
        { class: 'settings-head' },
        el('b', null, 'House Rules'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'hint', id: 'settings-note' }, 'Only the host can change these.'),
      ),
      this.presetHost,
      this.tabsHost,
      this.body,
      this.footHost,
    );
    this.renderTabs();
    void this.loadPresets();
  }

  private async loadPresets(): Promise<void> {
    try {
      const res = await fetch(apiUrl('/api/presets'), { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = (await res.json()) as { presets: RulePreset[] };
      this.presets = data.presets ?? [];
      this.renderPresets();
    } catch {
      /* presets are a convenience; the editor works without them */
    }
  }

  /** Called whenever fresh server state arrives. */
  setSettings(settings: GameSettings, editable: boolean): void {
    const editing = hasFocusWithin(this.el);
    this.editable = editable;
    // While the host is actively typing we keep the local draft authoritative,
    // otherwise the server echo would fight the cursor.
    if (!this.draft || Date.now() > this.quietUntil) {
      this.draft = structuredClone(settings);
    }
    const note = this.el.querySelector('#settings-note');
    if (note) {
      note.textContent = editable
        ? 'Changes are shared with everyone instantly.'
        : 'Only the host can change these.';
    }
    this.renderPresets();
    this.renderTabs();
    if (!editing) this.renderBody();
    this.renderFoot();
  }

  private commit(): void {
    if (!this.draft || !this.editable) return;
    this.quietUntil = Date.now() + 1200;
    window.clearTimeout(this.sendTimer);
    const payload = structuredClone(this.draft);
    this.sendTimer = window.setTimeout(() => this.onCommit(payload), 180);
    this.renderPresets();
  }

  /** Marks the settings as a custom mix once the host deviates from a preset. */
  private touched(): void {
    if (!this.draft) return;
    if (this.draft.presetName !== 'custom') this.draft.presetName = 'custom';
    this.commit();
  }

  /* ---------------------------------------------------------------- */
  /* Chrome                                                            */
  /* ---------------------------------------------------------------- */

  private renderPresets(): void {
    clear(this.presetHost);
    if (this.presets.length === 0) return;
    this.presetHost.appendChild(el('span', { class: 'tiny-label', style: { alignSelf: 'center' } }, 'Preset'));
    for (const preset of this.presets) {
      const active = this.draft?.presetName === preset.settings.presetName;
      this.presetHost.appendChild(
        button(
          `preset-chip${active ? ' active' : ''}`,
          preset.name,
          () => {
            if (!this.editable) return;
            sfx('click');
            this.draft = structuredClone(preset.settings);
            this.commit();
            this.renderBody();
            this.renderFoot();
          },
          { disabled: !this.editable, title: preset.description },
        ),
      );
    }
    if (this.draft?.presetName === 'custom') {
      this.presetHost.appendChild(el('span', { class: 'preset-chip active' }, 'Custom'));
    }
  }

  private renderTabs(): void {
    clear(this.tabsHost);
    for (const tab of TABS) {
      this.tabsHost.appendChild(
        button(`settings-tab${this.tab === tab.id ? ' active' : ''}`, tab.label, () => {
          this.tab = tab.id;
          sfx('hover');
          this.renderTabs();
          this.renderBody();
        }),
      );
    }
  }

  private renderFoot(): void {
    clear(this.footHost);
    const s = this.draft;
    if (!s) return;
    this.footHost.appendChild(
      el(
        'span',
        { class: 'hint' },
        `Start $${s.money.startingMoney} · ${s.dice.count}d${s.dice.sides} · levels 0-${s.property.maxLevel} · ` +
          `${s.events.enabled ? 'events on' : 'events off'} · ${victoryLabel(s)}`,
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Control builders                                                  */
  /* ---------------------------------------------------------------- */

  private row(title: string, help: string, control: HTMLElement): HTMLElement {
    return el(
      'div',
      { class: `setting${this.editable ? '' : ' locked'}` },
      el('div', { class: 'label' }, el('b', null, title), el('small', null, help)),
      el('div', { class: 'control' }, control),
    );
  }

  private num(
    title: string,
    help: string,
    get: () => number,
    set: (v: number) => void,
    opts: { min: number; max: number; step?: number; prefix?: string; suffix?: string },
  ): HTMLElement {
    const input = el('input', {
      type: 'number',
      value: get(),
      min: opts.min,
      max: opts.max,
      step: opts.step ?? 1,
      disabled: !this.editable,
      inputmode: 'numeric',
      on: {
        input: () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          set(Math.min(opts.max, Math.max(opts.min, v)));
          this.touched();
          this.renderFoot();
        },
        blur: () => {
          const v = Math.min(opts.max, Math.max(opts.min, Number(input.value) || opts.min));
          input.value = String(v);
        },
      },
    });
    const control = el(
      'div',
      { class: 'row' },
      opts.prefix ? el('span', { class: 'faint' }, opts.prefix) : null,
      input,
      opts.suffix ? el('span', { class: 'faint' }, opts.suffix) : null,
    );
    return this.row(title, help, control);
  }

  /** Percentage multiplier control — the "150% rent" style knob. */
  private mult(
    title: string,
    help: string,
    get: () => number,
    set: (v: number) => void,
    min = 25,
    max = 400,
  ): HTMLElement {
    const out = el('output', null, `${get()}%`);
    const range = el('input', {
      type: 'range',
      min,
      max,
      step: 5,
      value: get(),
      disabled: !this.editable,
      on: {
        input: () => {
          const v = Number(range.value);
          out.textContent = `${v}%`;
          set(v);
          this.touched();
        },
      },
    });
    return this.row(title, help, el('div', { class: 'mult' }, range, out));
  }

  private toggle(title: string, help: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const input = el('input', {
      type: 'checkbox',
      checked: get(),
      disabled: !this.editable,
      on: {
        change: () => {
          set(input.checked);
          this.touched();
          this.renderBody();
          this.renderFoot();
        },
      },
    });
    return this.row(title, help, input);
  }

  private choose<T extends string>(
    title: string,
    help: string,
    options: { value: T; label: string }[],
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const select = el('select', {
      disabled: !this.editable,
      on: {
        change: () => {
          set(select.value as T);
          this.touched();
          this.renderBody();
          this.renderFoot();
        },
      },
    });
    for (const option of options) {
      select.appendChild(el('option', { value: option.value, selected: get() === option.value }, option.label));
    }
    return this.row(title, help, select);
  }

  /* ---------------------------------------------------------------- */
  /* Tab bodies                                                        */
  /* ---------------------------------------------------------------- */

  private renderBody(): void {
    clear(this.body);
    const s = this.draft;
    if (!s) return;
    const add = (...nodes: (HTMLElement | null)[]) => {
      for (const n of nodes) if (n) this.body.appendChild(n);
    };

    switch (this.tab) {
      case 'money':
        add(
          this.num('Starting money', 'What every player begins with.', () => s.money.startingMoney, (v) => (s.money.startingMoney = v), { min: 100, max: 100000, step: 50, prefix: '$' }),
          this.num('Passing start', 'Paid each time a player completes a lap.', () => s.money.passStartAmount, (v) => (s.money.passStartAmount = v), { min: 0, max: 10000, step: 25, prefix: '$' }),
          this.num('Landing on start', 'Extra bonus for landing exactly on the start space.', () => s.money.landOnStartBonus, (v) => (s.money.landOnStartBonus = v), { min: 0, max: 10000, step: 25, prefix: '$' }),
          this.mult('Property prices', 'Scales every purchase price on the board.', () => s.money.propertyPriceMultiplier, (v) => (s.money.propertyPriceMultiplier = v)),
          this.mult('Rent', 'Scales every rent value, including utilities and transport.', () => s.money.rentMultiplier, (v) => (s.money.rentMultiplier = v)),
          this.mult('Build costs', 'Scales the cost of every upgrade level.', () => s.money.buildCostMultiplier, (v) => (s.money.buildCostMultiplier = v)),
          this.mult('Taxes', 'Scales tax spaces.', () => s.money.taxMultiplier, (v) => (s.money.taxMultiplier = v), 0),
          this.mult('Penalties', 'Scales penalty spaces and fees.', () => s.money.penaltyMultiplier, (v) => (s.money.penaltyMultiplier = v), 0),
          this.num('Detention fee', 'Flat cost to buy your way out of detention.', () => s.money.detentionFee, (v) => (s.money.detentionFee = v), { min: 0, max: 5000, step: 5, prefix: '$' }),
        );
        break;

      case 'dice':
        add(
          this.num('Dice count', 'How many dice are rolled each turn.', () => s.dice.count, (v) => (s.dice.count = v), { min: 1, max: 4 }),
          this.num('Sides per die', 'Six is standard; larger dice make laps much faster.', () => s.dice.sides, (v) => (s.dice.sides = v), { min: 2, max: 20 }),
          this.num('Bonus spaces', 'Added to every roll, before movement.', () => s.dice.bonusSpaces, (v) => (s.dice.bonusSpaces = v), { min: 0, max: 10 }),
          this.toggle('Doubles grant another turn', 'Rolling all dice the same lets you roll again.', () => s.dice.doublesGrantExtraTurn, (v) => (s.dice.doublesGrantExtraTurn = v)),
          s.dice.doublesGrantExtraTurn
            ? this.num('Max consecutive doubles', 'How many doubles in a row before the penalty applies.', () => s.dice.maxConsecutiveDoubles, (v) => (s.dice.maxConsecutiveDoubles = v), { min: 1, max: 10 })
            : null,
          s.dice.doublesGrantExtraTurn
            ? this.choose(
                'After too many doubles',
                'What happens when the streak limit is hit.',
                [
                  { value: 'detention', label: 'Sent to detention' },
                  { value: 'lose_turn', label: 'Lose the turn' },
                  { value: 'nothing', label: 'Nothing' },
                ],
                () => s.dice.onMaxDoubles,
                (v) => (s.dice.onMaxDoubles = v),
              )
            : null,
        );
        break;

      case 'property':
        add(
          this.num('Upgrade levels', 'How far a property can be developed.', () => s.property.maxLevel, (v) => (s.property.maxLevel = v), { min: 1, max: 5 }),
          this.toggle('Top level is a landmark', 'The final level replaces the small buildings with a tower.', () => s.property.towerEnabled, (v) => (s.property.towerEnabled = v)),
          this.toggle('Build evenly', 'Levels across a colour group must stay within one of each other.', () => s.property.evenBuildingRequired, (v) => (s.property.evenBuildingRequired = v)),
          this.toggle('Full group required to build', 'You must own every space in a colour group first.', () => s.property.buildingsRequireFullGroup, (v) => (s.property.buildingsRequireFullGroup = v)),
          this.mult('Full-group rent bonus', 'Rent multiplier on undeveloped spaces when you own the whole group.', () => s.property.fullGroupRentMultiplier, (v) => (s.property.fullGroupRentMultiplier = v), 100, 400),
          this.toggle('Mortgaging allowed', 'Players can raise cash against their deeds.', () => s.property.mortgageEnabled, (v) => (s.property.mortgageEnabled = v)),
          s.property.mortgageEnabled
            ? this.mult('Mortgage value', 'Percentage of the purchase price paid out.', () => s.property.mortgageValuePercent, (v) => (s.property.mortgageValuePercent = v), 10, 100)
            : null,
          s.property.mortgageEnabled
            ? this.mult('Unmortgage interest', 'Extra percentage charged to lift a mortgage.', () => s.property.unmortgageInterestPercent, (v) => (s.property.unmortgageInterestPercent = v), 0, 100)
            : null,
          this.mult('Building sell-back', 'What the bank pays for a demolished level.', () => s.property.sellBuildingRefundPercent, (v) => (s.property.sellBuildingRefundPercent = v), 0, 100),
          this.toggle('Auction declined properties', 'Anything a player passes on goes to open bidding.', () => s.property.auctionsEnabled, (v) => (s.property.auctionsEnabled = v)),
          s.property.auctionsEnabled
            ? this.num('Auction timer', 'Seconds before an auction closes.', () => s.property.auctionSeconds, (v) => (s.property.auctionSeconds = v), { min: 5, max: 120, suffix: 's' })
            : null,
          s.property.auctionsEnabled
            ? this.num('Minimum bid step', 'Smallest raise allowed.', () => s.property.auctionMinIncrement, (v) => (s.property.auctionMinIncrement = v), { min: 1, max: 500, prefix: '$' })
            : null,
          this.toggle('Collect rent while detained', 'Owners in detention still earn rent.', () => s.property.collectRentInDetention, (v) => (s.property.collectRentInDetention = v)),
        );
        break;

      case 'detention':
        add(
          this.toggle('Detention enabled', 'Turn the holding yard on or off entirely.', () => s.detention.enabled, (v) => (s.detention.enabled = v)),
          s.detention.enabled
            ? this.num('Turns held', 'How many turns a player is stuck for.', () => s.detention.turns, (v) => (s.detention.turns = v), { min: 1, max: 6 })
            : null,
          s.detention.enabled
            ? this.toggle('Escape with doubles', 'Rolling doubles releases you immediately.', () => s.detention.escapeWithDoubles, (v) => (s.detention.escapeWithDoubles = v))
            : null,
          s.detention.enabled
            ? this.toggle('Pay to leave', 'Players may pay the fee to get out early.', () => s.detention.payToLeaveAllowed, (v) => (s.detention.payToLeaveAllowed = v))
            : null,
          s.detention.enabled
            ? this.toggle('Release cards allowed', 'Event cards can grant a free release.', () => s.detention.cardsAllowed, (v) => (s.detention.cardsAllowed = v))
            : null,
          s.detention.enabled
            ? this.toggle('Must pay after max turns', 'The fee is taken automatically once the hold expires.', () => s.detention.mustPayAfterMaxTurns, (v) => (s.detention.mustPayAfterMaxTurns = v))
            : null,
        );
        break;

      case 'reststop':
        add(
          this.choose(
            'Rest stop payout',
            'What landing on the garden space does.',
            [
              { value: 'nothing', label: 'Nothing' },
              { value: 'fixed', label: 'Fixed amount' },
              { value: 'pot', label: 'Take the whole pot' },
              { value: 'percent', label: 'Percentage of the pot' },
            ],
            () => s.restStop.mode,
            (v) => (s.restStop.mode = v),
          ),
          s.restStop.mode === 'fixed'
            ? this.num('Payout', 'Amount handed out on landing.', () => s.restStop.fixedAmount, (v) => (s.restStop.fixedAmount = v), { min: 0, max: 10000, step: 25, prefix: '$' })
            : null,
          s.restStop.mode === 'percent'
            ? this.mult('Share of the pot', 'How much of the pot is collected.', () => s.restStop.percentOfPot, (v) => (s.restStop.percentOfPot = v), 5, 100)
            : null,
          s.restStop.mode !== 'nothing'
            ? this.toggle('Taxes feed the pot', 'Tax payments are added to the pot.', () => s.restStop.potFromTaxes, (v) => (s.restStop.potFromTaxes = v))
            : null,
          s.restStop.mode !== 'nothing'
            ? this.toggle('Fees feed the pot', 'Detention fees are added to the pot.', () => s.restStop.potFromFees, (v) => (s.restStop.potFromFees = v))
            : null,
          s.restStop.mode !== 'nothing'
            ? this.toggle('Penalties feed the pot', 'Card penalties are added to the pot.', () => s.restStop.potFromPenalties, (v) => (s.restStop.potFromPenalties = v))
            : null,
        );
        break;

      case 'events': {
        add(
          this.toggle('Event cards enabled', 'The city throws surprises at players.', () => s.events.enabled, (v) => (s.events.enabled = v)),
          s.events.enabled
            ? this.choose(
                'Frequency',
                'How often cards are drawn.',
                [
                  { value: 'low', label: 'Low' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' },
                ],
                () => (s.events.frequency === 'off' ? 'low' : s.events.frequency),
                (v) => (s.events.frequency = v),
              )
            : null,
          s.events.enabled
            ? this.mult('Card strength', 'Scales every money amount printed on a card.', () => s.events.strength, (v) => (s.events.strength = v), 0, 300)
            : null,
        );
        if (s.events.enabled) {
          const chips = el('div', { class: 'cat-toggles' });
          for (const cat of CATEGORIES) {
            const off = s.events.disabledCategories.includes(cat.id);
            chips.appendChild(
              button(
                `preset-chip${off ? '' : ' active'}`,
                cat.label,
                () => {
                  if (!this.editable) return;
                  sfx('click');
                  const list = s.events.disabledCategories;
                  const at = list.indexOf(cat.id);
                  if (at >= 0) list.splice(at, 1);
                  else if (list.length < CATEGORIES.length - 1) list.push(cat.id);
                  this.touched();
                  this.renderBody();
                },
                { disabled: !this.editable },
              ),
            );
          }
          this.body.appendChild(
            this.row('Card categories', 'Switch off the kinds of card you would rather not see.', chips),
          );
        }
        break;
      }

      case 'trading':
        add(
          this.toggle('Trading enabled', 'Players can offer deals to each other.', () => s.trading.enabled, (v) => (s.trading.enabled = v)),
          s.trading.enabled
            ? this.toggle('Money can be traded', '', () => s.trading.allowMoney, (v) => (s.trading.allowMoney = v))
            : null,
          s.trading.enabled
            ? this.toggle('Properties can be traded', '', () => s.trading.allowProperties, (v) => (s.trading.allowProperties = v))
            : null,
          s.trading.enabled
            ? this.toggle('Mortgaged deeds can be traded', 'Allows underwater properties to change hands.', () => s.trading.allowMortgaged, (v) => (s.trading.allowMortgaged = v))
            : null,
          s.trading.enabled
            ? this.toggle('Release cards can be traded', '', () => s.trading.allowEscapeCards, (v) => (s.trading.allowEscapeCards = v))
            : null,
          s.trading.enabled
            ? this.toggle('Only on your own turn', 'Restricts trading to the active player.', () => s.trading.onlyOnYourTurn, (v) => (s.trading.onlyOnYourTurn = v))
            : null,
        );
        break;

      case 'bankruptcy':
        add(
          this.choose(
            'Where the estate goes',
            'What happens to a bankrupt player’s property.',
            [
              { value: 'to_creditor', label: 'To whoever they owed' },
              { value: 'to_auction', label: 'Straight to auction' },
              { value: 'to_bank', label: 'Back to the bank' },
            ],
            () => s.bankruptcy.assetMode,
            (v) => (s.bankruptcy.assetMode = v),
          ),
          this.mult('Building payout', 'What the bank pays for buildings when a player folds.', () => s.bankruptcy.buildingRefundPercent, (v) => (s.bankruptcy.buildingRefundPercent = v), 0, 100),
          this.toggle('Transfer deeds mortgaged', 'Inherited properties arrive mortgaged.', () => s.bankruptcy.transferMortgaged, (v) => (s.bankruptcy.transferMortgaged = v)),
          this.toggle('Eliminate the player', 'Off means they stay at the table as a spectator.', () => s.bankruptcy.eliminatePlayer, (v) => (s.bankruptcy.eliminatePlayer = v)),
        );
        break;

      case 'victory':
        add(
          this.choose(
            'How the game is won',
            '',
            [
              { value: 'last_standing', label: 'Last player standing' },
              { value: 'wealth_target', label: 'First to a wealth target' },
              { value: 'turn_limit', label: 'Richest after N rounds' },
            ],
            () => s.victory.mode,
            (v) => (s.victory.mode = v),
          ),
          s.victory.mode === 'wealth_target'
            ? this.num('Wealth target', 'Total net worth needed to win.', () => s.victory.wealthTarget, (v) => (s.victory.wealthTarget = v), { min: 500, max: 500000, step: 500, prefix: '$' })
            : null,
          s.victory.mode === 'turn_limit'
            ? this.num('Round limit', 'The game ends after this many full rounds.', () => s.victory.turnLimit, (v) => (s.victory.turnLimit = v), { min: 5, max: 500 })
            : null,
        );
        break;

      case 'game':
        add(
          this.choose(
            'Game speed',
            'Affects animation pacing only — never the rules.',
            [
              { value: 'slow', label: 'Slow and cinematic' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ],
            () => s.speed,
            (v) => (s.speed = v),
          ),
          this.num('Maximum players', 'Seats available in this room.', () => s.maxPlayers, (v) => (s.maxPlayers = v), { min: 2, max: 6 }),
          this.num('Turn time limit', 'Seconds before an idle turn is played automatically. 0 disables it.', () => s.turnTimeLimit, (v) => (s.turnTimeLimit = v), { min: 0, max: 600, step: 5, suffix: 's' }),
        );
        break;
    }
  }
}

function victoryLabel(s: GameSettings): string {
  switch (s.victory.mode) {
    case 'wealth_target':
      return `first to $${s.victory.wealthTarget}`;
    case 'turn_limit':
      return `${s.victory.turnLimit} rounds`;
    default:
      return 'last standing';
  }
}
