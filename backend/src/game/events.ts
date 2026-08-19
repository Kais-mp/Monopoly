/**
 * "City Pulse" event deck.
 *
 * Entirely data-driven: adding a card is adding an entry here. The engine
 * understands the effect kinds in `EventEffect`, so new cards need no code.
 * Money amounts are scaled by the host's `events.strength` setting.
 */
import type { EventCard } from '../shared/types';

export const EVENT_DECK: EventCard[] = [
  /* ---------------- fortune ---------------- */
  {
    id: 'harbour-dividend',
    title: 'Harbour Dividend',
    text: 'The port authority posts a record quarter. Shareholders eat well.',
    category: 'fortune',
    effects: [{ kind: 'money', amount: 200 }],
  },
  {
    id: 'salvage-claim',
    title: 'Salvage Claim',
    text: 'A container of vintage arcade cabinets washes up with your name on the manifest.',
    category: 'fortune',
    effects: [{ kind: 'money', amount: 120 }],
  },
  {
    id: 'grant-approved',
    title: 'Grant Approved',
    text: 'Your restoration proposal for the old tram sheds clears the council.',
    category: 'fortune',
    effects: [{ kind: 'money', amount: 300 }],
  },
  {
    id: 'street-festival',
    title: 'Street Festival',
    text: 'You host the lantern festival. Every other resident chips in for the fireworks.',
    category: 'fortune',
    effects: [{ kind: 'collect_from_each', amount: 40 }],
  },
  {
    id: 'lottery-ticket',
    title: 'Ridge Lottery',
    text: 'Third prize, but the ticket cost you nothing.',
    category: 'fortune',
    effects: [{ kind: 'money', amount: 75 }],
  },
  {
    id: 'insurance-payout',
    title: 'Insurance Payout',
    text: 'The claim you filed two winters ago is finally settled.',
    category: 'fortune',
    effects: [{ kind: 'money', amount: 150 }],
  },

  /* ---------------- setback ---------------- */
  {
    id: 'permit-fine',
    title: 'Permit Fine',
    text: 'Scaffolding left up eleven months past its permit.',
    category: 'setback',
    effects: [{ kind: 'money', amount: -120 }],
  },
  {
    id: 'storm-damage',
    title: 'Storm Surge',
    text: 'The bay comes over the seawall. Repairs are assessed per building.',
    category: 'setback',
    effects: [{ kind: 'repairs', perLevel: 40, perTower: 115 }],
  },
  {
    id: 'inspection',
    title: 'Surprise Inspection',
    text: 'Structural review of every floor you have added.',
    category: 'setback',
    effects: [{ kind: 'repairs', perLevel: 25, perTower: 100 }],
  },
  {
    id: 'round-of-drinks',
    title: 'Round at the Quay',
    text: 'You lost the bet. You are buying, for everyone.',
    category: 'setback',
    effects: [{ kind: 'pay_each', amount: 50 }],
  },
  {
    id: 'audit',
    title: 'Civic Audit',
    text: 'Your books are, technically, fiction.',
    category: 'setback',
    effects: [{ kind: 'money', amount: -180 }],
  },
  {
    id: 'towed',
    title: 'Towed',
    text: 'Parked in a loading bay on Lumen Boulevard. Twice.',
    category: 'setback',
    effects: [{ kind: 'money', amount: -60 }],
  },

  /* ---------------- movement ---------------- */
  {
    id: 'advance-plaza',
    title: 'Summoned to the Plaza',
    text: 'The council wants a word. Report to Grand Plaza.',
    category: 'movement',
    effects: [{ kind: 'move_to', space: 37, collectStart: true }],
  },
  {
    id: 'back-to-start',
    title: 'Return to Launch Plaza',
    text: 'Back to where it all began. Collect your stipend on arrival.',
    category: 'movement',
    effects: [{ kind: 'move_to', space: 0, collectStart: true }],
  },
  {
    id: 'missed-stop',
    title: 'Missed Your Stop',
    text: 'You were reading. Go back three spaces.',
    category: 'movement',
    effects: [{ kind: 'move_relative', steps: -3 }],
  },
  {
    id: 'express-lane',
    title: 'Express Lane',
    text: 'A gap in the traffic. Advance two spaces.',
    category: 'movement',
    effects: [{ kind: 'move_relative', steps: 2 }],
  },
  {
    id: 'catch-the-rail',
    title: 'Catch the Rail',
    text: 'Ride to the nearest terminal. If it is owned, pay the operator double.',
    category: 'movement',
    effects: [{ kind: 'move_nearest', spaceType: 'transport', rentMultiplier: 2 }],
  },
  {
    id: 'grid-inspection',
    title: 'Grid Inspection',
    text: 'Report to the nearest city works. If owned, pay ten times your roll.',
    category: 'movement',
    effects: [{ kind: 'move_nearest', spaceType: 'utility', rentMultiplier: 10 }],
  },
  {
    id: 'marina-opening',
    title: 'Marina Reopening',
    text: 'The Lantern Quay ribbon-cutting needs a guest of honour.',
    category: 'movement',
    effects: [{ kind: 'move_to', space: 9, collectStart: true }],
  },

  /* ---------------- civic ---------------- */
  {
    id: 'detained-card',
    title: 'Paperwork Irregularity',
    text: 'Harbour patrol escorts you to the Holding Yard. Do not pass Launch Plaza.',
    category: 'civic',
    effects: [{ kind: 'go_detention' }],
  },
  {
    id: 'legal-favour',
    title: 'A Friend at the Desk',
    text: 'Keep this. It will get you out of the Holding Yard once.',
    category: 'civic',
    effects: [{ kind: 'escape_card' }],
  },
  {
    id: 'legal-favour-2',
    title: 'Filed in Advance',
    text: 'Your lawyer pre-filed the release. Keep it for when you need it.',
    category: 'civic',
    effects: [{ kind: 'escape_card' }],
  },
  {
    id: 'civic-levy',
    title: 'Emergency Levy',
    text: 'The seawall fund is short. Your contribution goes to the gardens pool.',
    category: 'civic',
    effects: [{ kind: 'pot_add', amount: 100 }],
  },
  {
    id: 'gardens-grant',
    title: 'Gardens Windfall',
    text: 'The Aurora Gardens trust releases everything it has been sitting on.',
    category: 'civic',
    effects: [{ kind: 'pot_take' }],
  },

  /* ---------------- chaos ---------------- */
  {
    id: 'rent-spike',
    title: 'Rent Spike',
    text: 'Demand surges across your holdings. Rent you collect is doubled for three turns.',
    category: 'chaos',
    effects: [{ kind: 'rent_modifier', multiplier: 200, turns: 3 }],
  },
  {
    id: 'rent-freeze',
    title: 'Rent Freeze',
    text: 'The council caps your rents at half for three turns. Popular with everyone but you.',
    category: 'chaos',
    effects: [{ kind: 'rent_modifier', multiplier: 50, turns: 3 }],
  },
  {
    id: 'developer-discount',
    title: 'Developer Discount',
    text: 'A contractor owes you a favour. 25% off purchases for three turns.',
    category: 'chaos',
    effects: [{ kind: 'purchase_discount', percent: 25, turns: 3 }],
  },
  {
    id: 'tide-shift',
    title: 'Tide Shift',
    text: 'The whole city takes one step forward. Nobody is quite sure why.',
    category: 'chaos',
    effects: [{ kind: 'all_move_relative', steps: 1 }],
  },
  {
    id: 'blackout',
    title: 'Rolling Blackout',
    text: 'Grid failure across the bay. Everyone pays you for the generators you happen to own.',
    category: 'chaos',
    effects: [{ kind: 'collect_from_each', amount: 25 }],
  },
];

export function deckForSettings(disabled: string[]): EventCard[] {
  const usable = EVENT_DECK.filter((c) => !disabled.includes(c.category));
  return usable.length > 0 ? usable : EVENT_DECK;
}
