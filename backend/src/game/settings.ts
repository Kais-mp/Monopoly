/**
 * Default settings, built-in presets, and the sanitiser that every incoming
 * settings object is run through. Nothing from a client is trusted: values are
 * clamped to sane ranges before they can reach the engine.
 */
import type { EventCategory, GameSettings, RulePreset } from '../shared/types';

export const DEFAULT_SETTINGS: GameSettings = {
  presetName: 'Classic',
  money: {
    startingMoney: 1500,
    passStartAmount: 200,
    landOnStartBonus: 0,
    propertyPriceMultiplier: 100,
    rentMultiplier: 100,
    buildCostMultiplier: 100,
    taxMultiplier: 100,
    detentionFee: 50,
    penaltyMultiplier: 100,
  },
  dice: {
    count: 2,
    sides: 6,
    doublesGrantExtraTurn: true,
    maxConsecutiveDoubles: 3,
    onMaxDoubles: 'detention',
    bonusSpaces: 0,
  },
  property: {
    maxLevel: 5,
    towerEnabled: true,
    evenBuildingRequired: true,
    buildingsRequireFullGroup: true,
    fullGroupRentMultiplier: 200,
    mortgageEnabled: true,
    mortgageValuePercent: 50,
    unmortgageInterestPercent: 10,
    sellBuildingRefundPercent: 50,
    auctionsEnabled: true,
    auctionSeconds: 20,
    auctionMinIncrement: 10,
    collectRentInDetention: true,
  },
  detention: {
    enabled: true,
    turns: 3,
    escapeWithDoubles: true,
    payToLeaveAllowed: true,
    cardsAllowed: true,
    mustPayAfterMaxTurns: true,
  },
  restStop: {
    mode: 'nothing',
    fixedAmount: 200,
    percentOfPot: 100,
    potFromTaxes: true,
    potFromFees: true,
    potFromPenalties: true,
  },
  events: {
    enabled: true,
    frequency: 'normal',
    strength: 100,
    disabledCategories: [],
  },
  trading: {
    enabled: true,
    allowMoney: true,
    allowProperties: true,
    allowMortgaged: true,
    allowEscapeCards: true,
    onlyOnYourTurn: false,
  },
  bankruptcy: {
    assetMode: 'to_creditor',
    buildingRefundPercent: 50,
    transferMortgaged: true,
    eliminatePlayer: true,
  },
  victory: {
    mode: 'last_standing',
    wealthTarget: 10000,
    turnLimit: 40,
  },
  speed: 'normal',
  maxPlayers: 6,
  turnTimeLimit: 90,
};

function clone(s: GameSettings): GameSettings {
  return JSON.parse(JSON.stringify(s)) as GameSettings;
}

function withOverrides(name: string, fn: (s: GameSettings) => void): GameSettings {
  const s = clone(DEFAULT_SETTINGS);
  s.presetName = name;
  fn(s);
  return s;
}

export const PRESETS: RulePreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'The balanced ruleset. $1,500 to start, normal rents, auctions and trading on.',
    settings: clone(DEFAULT_SETTINGS),
  },
  {
    id: 'chaos',
    name: 'Chaos',
    description: 'Deep pockets, brutal rents, a fat jackpot in the gardens and constant events.',
    settings: withOverrides('Chaos', (s) => {
      s.money.startingMoney = 5000;
      s.money.passStartAmount = 400;
      s.money.rentMultiplier = 200;
      s.restStop.mode = 'pot';
      s.restStop.percentOfPot = 100;
      s.events.frequency = 'high';
      s.events.strength = 150;
      s.dice.bonusSpaces = 0;
      s.speed = 'fast';
      s.detention.turns = 2;
    }),
  },
  {
    id: 'speed',
    name: 'Speed Run',
    description: 'Short and vicious. Big bankroll, high rent, quick detention, 30-turn limit.',
    settings: withOverrides('Speed Run', (s) => {
      s.money.startingMoney = 3000;
      s.money.passStartAmount = 300;
      s.money.rentMultiplier = 175;
      s.money.propertyPriceMultiplier = 90;
      s.detention.turns = 1;
      s.money.detentionFee = 25;
      s.victory.mode = 'turn_limit';
      s.victory.turnLimit = 30;
      s.speed = 'fast';
      s.property.auctionsEnabled = true;
    }),
  },
  {
    id: 'tycoon',
    name: 'Tycoon Race',
    description: 'First to a $12,000 net worth takes it. Cheap land, expensive towers.',
    settings: withOverrides('Tycoon Race', (s) => {
      s.money.startingMoney = 2000;
      s.money.propertyPriceMultiplier = 80;
      s.money.buildCostMultiplier = 130;
      s.money.rentMultiplier = 130;
      s.victory.mode = 'wealth_target';
      s.victory.wealthTarget = 12000;
    }),
  },
  {
    id: 'friendly',
    name: 'Friendly',
    description: 'Gentle rules for a relaxed table. Soft rents, no auctions, generous start.',
    settings: withOverrides('Friendly', (s) => {
      s.money.startingMoney = 2500;
      s.money.rentMultiplier = 70;
      s.money.taxMultiplier = 50;
      s.property.auctionsEnabled = false;
      s.detention.turns = 1;
      s.restStop.mode = 'fixed';
      s.restStop.fixedAmount = 150;
      s.speed = 'normal';
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Sanitising                                                          */
/* ------------------------------------------------------------------ */

function num(value: unknown, fallback: number, min: number, max: number, integer = true): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : clamped;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const EVENT_CATEGORIES: EventCategory[] = ['fortune', 'setback', 'movement', 'civic', 'chaos'];

/**
 * Produce a settings object that is safe to hand to the engine, no matter what
 * the client sent. Unknown fields are dropped; out-of-range values are clamped.
 */
export function sanitizeSettings(input: unknown): GameSettings {
  const raw = (input ?? {}) as Record<string, any>;
  const d = DEFAULT_SETTINGS;
  const money = raw.money ?? {};
  const dice = raw.dice ?? {};
  const property = raw.property ?? {};
  const detention = raw.detention ?? {};
  const restStop = raw.restStop ?? {};
  const events = raw.events ?? {};
  const trading = raw.trading ?? {};
  const bankruptcy = raw.bankruptcy ?? {};
  const victory = raw.victory ?? {};

  const disabled = Array.isArray(events.disabledCategories)
    ? (events.disabledCategories as unknown[]).filter((c): c is EventCategory =>
        EVENT_CATEGORIES.includes(c as EventCategory),
      )
    : [];

  return {
    presetName:
      typeof raw.presetName === 'string' && raw.presetName.trim()
        ? raw.presetName.trim().slice(0, 24)
        : 'Custom',
    money: {
      startingMoney: num(money.startingMoney, d.money.startingMoney, 100, 1_000_000),
      passStartAmount: num(money.passStartAmount, d.money.passStartAmount, 0, 100_000),
      landOnStartBonus: num(money.landOnStartBonus, d.money.landOnStartBonus, 0, 100_000),
      propertyPriceMultiplier: num(money.propertyPriceMultiplier, 100, 10, 1000),
      rentMultiplier: num(money.rentMultiplier, 100, 0, 1000),
      buildCostMultiplier: num(money.buildCostMultiplier, 100, 10, 1000),
      taxMultiplier: num(money.taxMultiplier, 100, 0, 1000),
      detentionFee: num(money.detentionFee, d.money.detentionFee, 0, 100_000),
      penaltyMultiplier: num(money.penaltyMultiplier, 100, 0, 1000),
    },
    dice: {
      count: num(dice.count, d.dice.count, 1, 4),
      sides: num(dice.sides, d.dice.sides, 4, 20),
      doublesGrantExtraTurn: bool(dice.doublesGrantExtraTurn, d.dice.doublesGrantExtraTurn),
      maxConsecutiveDoubles: num(dice.maxConsecutiveDoubles, d.dice.maxConsecutiveDoubles, 1, 10),
      onMaxDoubles: pick(dice.onMaxDoubles, ['detention', 'lose_turn', 'nothing'] as const, d.dice.onMaxDoubles),
      bonusSpaces: num(dice.bonusSpaces, 0, 0, 12),
    },
    property: {
      maxLevel: num(property.maxLevel, d.property.maxLevel, 1, 5),
      towerEnabled: bool(property.towerEnabled, d.property.towerEnabled),
      evenBuildingRequired: bool(property.evenBuildingRequired, d.property.evenBuildingRequired),
      buildingsRequireFullGroup: bool(property.buildingsRequireFullGroup, d.property.buildingsRequireFullGroup),
      fullGroupRentMultiplier: num(property.fullGroupRentMultiplier, 200, 100, 1000),
      mortgageEnabled: bool(property.mortgageEnabled, d.property.mortgageEnabled),
      mortgageValuePercent: num(property.mortgageValuePercent, 50, 10, 100),
      unmortgageInterestPercent: num(property.unmortgageInterestPercent, 10, 0, 100),
      sellBuildingRefundPercent: num(property.sellBuildingRefundPercent, 50, 0, 100),
      auctionsEnabled: bool(property.auctionsEnabled, d.property.auctionsEnabled),
      auctionSeconds: num(property.auctionSeconds, 20, 8, 120),
      auctionMinIncrement: num(property.auctionMinIncrement, 10, 1, 1000),
      collectRentInDetention: bool(property.collectRentInDetention, d.property.collectRentInDetention),
    },
    detention: {
      enabled: bool(detention.enabled, d.detention.enabled),
      turns: num(detention.turns, d.detention.turns, 1, 10),
      escapeWithDoubles: bool(detention.escapeWithDoubles, d.detention.escapeWithDoubles),
      payToLeaveAllowed: bool(detention.payToLeaveAllowed, d.detention.payToLeaveAllowed),
      cardsAllowed: bool(detention.cardsAllowed, d.detention.cardsAllowed),
      mustPayAfterMaxTurns: bool(detention.mustPayAfterMaxTurns, d.detention.mustPayAfterMaxTurns),
    },
    restStop: {
      mode: pick(restStop.mode, ['nothing', 'fixed', 'pot', 'percent'] as const, d.restStop.mode),
      fixedAmount: num(restStop.fixedAmount, d.restStop.fixedAmount, 0, 100_000),
      percentOfPot: num(restStop.percentOfPot, 100, 1, 100),
      potFromTaxes: bool(restStop.potFromTaxes, d.restStop.potFromTaxes),
      potFromFees: bool(restStop.potFromFees, d.restStop.potFromFees),
      potFromPenalties: bool(restStop.potFromPenalties, d.restStop.potFromPenalties),
    },
    events: {
      enabled: bool(events.enabled, d.events.enabled),
      frequency: pick(events.frequency, ['off', 'low', 'normal', 'high'] as const, d.events.frequency),
      strength: num(events.strength, 100, 10, 500),
      disabledCategories: disabled,
    },
    trading: {
      enabled: bool(trading.enabled, d.trading.enabled),
      allowMoney: bool(trading.allowMoney, d.trading.allowMoney),
      allowProperties: bool(trading.allowProperties, d.trading.allowProperties),
      allowMortgaged: bool(trading.allowMortgaged, d.trading.allowMortgaged),
      allowEscapeCards: bool(trading.allowEscapeCards, d.trading.allowEscapeCards),
      onlyOnYourTurn: bool(trading.onlyOnYourTurn, d.trading.onlyOnYourTurn),
    },
    bankruptcy: {
      assetMode: pick(
        bankruptcy.assetMode,
        ['to_creditor', 'to_auction', 'to_bank'] as const,
        d.bankruptcy.assetMode,
      ),
      buildingRefundPercent: num(bankruptcy.buildingRefundPercent, 50, 0, 100),
      transferMortgaged: bool(bankruptcy.transferMortgaged, d.bankruptcy.transferMortgaged),
      eliminatePlayer: bool(bankruptcy.eliminatePlayer, d.bankruptcy.eliminatePlayer),
    },
    victory: {
      mode: pick(victory.mode, ['last_standing', 'wealth_target', 'turn_limit'] as const, d.victory.mode),
      wealthTarget: num(victory.wealthTarget, d.victory.wealthTarget, 500, 10_000_000),
      turnLimit: num(victory.turnLimit, d.victory.turnLimit, 5, 500),
    },
    speed: pick(raw.speed, ['slow', 'normal', 'fast'] as const, d.speed),
    maxPlayers: num(raw.maxPlayers, d.maxPlayers, 2, 6),
    turnTimeLimit: num(raw.turnTimeLimit, d.turnTimeLimit, 0, 600),
  };
}

export function defaultSettings(): GameSettings {
  return clone(DEFAULT_SETTINGS);
}
