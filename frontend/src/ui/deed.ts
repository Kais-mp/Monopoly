/**
 * Title deed panel.
 *
 * Shows exactly what the server says about a space and offers only the actions
 * that are legal right now — the server re-checks every one of them anyway.
 */
import type { ClientAction } from '@shared/protocol';
import type { BoardSpace } from '@shared/types';
import { store } from '../store';
import { money } from '../util';
import { button, el } from './dom';
import { sfx } from '../audio/audio';

function levelName(level: number, maxLevel: number, towerEnabled: boolean): string {
  if (level <= 0) return 'Undeveloped';
  if (towerEnabled && level >= maxLevel) return 'Landmark tower';
  return ['', 'Small build', 'Larger build', 'Large build', 'Luxury build', 'Landmark'][level] ?? `Level ${level}`;
}

export function levelPips(level: number, maxLevel: number, towerEnabled: boolean): HTMLElement {
  const host = el('span', { class: 'levels' });
  for (let i = 1; i <= maxLevel; i++) {
    const isTower = towerEnabled && i === maxLevel;
    host.appendChild(
      el('i', { class: `${level >= i ? 'on' : ''} ${isTower ? 'tower' : ''}`.trim() }),
    );
  }
  return host;
}

function rentRows(space: BoardSpace, currentLevel: number, ownedInGroup: number): HTMLElement {
  const state = store.state!;
  const rows = el('div', { class: 'rent-table' });
  const add = (label: string, value: string, current: boolean) =>
    rows.appendChild(
      el('div', { class: `r${current ? ' current' : ''}` }, el('span', null, label), el('span', null, value)),
    );

  if (space.type === 'utility' && space.utilityMultipliers) {
    add('One utility owned', `${space.utilityMultipliers[0]}× the dice roll`, ownedInGroup === 1);
    add('Both utilities owned', `${space.utilityMultipliers[1]}× the dice roll`, ownedInGroup >= 2);
    return rows;
  }

  const rent = space.rent ?? [];
  if (space.type === 'transport') {
    rent.forEach((value, index) => {
      add(`${index + 1} in the network`, money(value), ownedInGroup === index + 1);
    });
    return rows;
  }

  const maxLevel = state.settings.property.maxLevel;
  const tower = state.settings.property.towerEnabled;
  rent.forEach((value, index) => {
    if (index > maxLevel) return;
    add(levelName(index, maxLevel, tower), money(value), currentLevel === index);
  });
  return rows;
}

export interface DeedOptions {
  send: (action: ClientAction) => void;
  compact?: boolean;
}

export function buildDeed(spaceId: number, options: DeedOptions): HTMLElement {
  const state = store.state;
  const space = store.space(spaceId);
  if (!state || !space) return el('div', { class: 'hint' }, 'Nothing here.');

  const prop = store.property(spaceId);
  const owner = prop?.ownerId ? store.player(prop.ownerId) : null;
  const me = store.me();
  const group = store.group(space.group);
  const color = group?.color ?? '#3ec7ff';

  const head = el(
    'div',
    { class: 'deed-head', style: { '--dc': color } },
    group ? el('div', { class: 'grp' }, group.name) : el('div', { class: 'grp' }, space.type.replace('_', ' ')),
    el('h3', null, space.name),
  );

  const body = el('div', { class: 'deed-body' });
  if (space.flavor) body.appendChild(el('div', { class: 'deed-flavor' }, space.flavor));

  if (space.price !== undefined) {
    const ownedInGroup = owner
      ? state.board.filter((b) => b.group === space.group && state.properties[b.id]?.ownerId === owner.id).length
      : 0;

    body.appendChild(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'tiny-label' }, 'Price'),
        el('span', { class: 'spacer' }),
        el('b', { class: 'money' }, money(space.price)),
      ),
    );

    if (owner) {
      body.appendChild(
        el(
          'div',
          { class: 'owner-tag' },
          el('span', { class: 'dot', style: { color: owner.color } }),
          el('span', null, owner.id === me?.id ? 'Owned by you' : `Owned by ${owner.name}`),
          el('span', { class: 'spacer' }),
          prop?.mortgaged ? el('span', { class: 'pill bad' }, 'MORTGAGED') : null,
        ),
      );
    } else {
      body.appendChild(el('div', { class: 'owner-tag' }, 'Unowned — available'));
    }

    body.appendChild(rentRows(space, prop?.level ?? 0, ownedInGroup));

    if (space.buildCost !== undefined && space.type === 'property') {
      body.appendChild(
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'tiny-label' }, 'Cost per level'),
          el('span', { class: 'spacer' }),
          el('span', { class: 'money' }, money(space.buildCost)),
        ),
      );
      body.appendChild(
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'tiny-label' }, 'Development'),
          el('span', { class: 'spacer' }),
          levelPips(prop?.level ?? 0, state.settings.property.maxLevel, state.settings.property.towerEnabled),
        ),
      );
    }

    if (state.settings.property.mortgageEnabled) {
      const value = Math.floor((space.price * state.settings.property.mortgageValuePercent) / 100);
      body.appendChild(
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'tiny-label' }, 'Mortgage value'),
          el('span', { class: 'spacer' }),
          el('span', { class: 'money faint' }, money(value)),
        ),
      );
    }

    /* Owner actions ------------------------------------------------- */
    if (me && owner?.id === me.id && state.phase === 'playing') {
      const actions = el('div', { class: 'row wrap', style: { marginTop: '4px' } });
      const send = (action: ClientAction) => {
        sfx('click');
        options.send(action);
      };
      const canManage = !me.bankrupt;
      const level = prop?.level ?? 0;
      const maxLevel = state.settings.property.maxLevel;

      if (space.type === 'property') {
        actions.appendChild(
          button(
            'btn small good',
            `Build ${money(space.buildCost ?? 0)}`,
            () => send({ type: 'build', spaceId }),
            { disabled: !canManage || level >= maxLevel || !!prop?.mortgaged },
          ),
        );
        actions.appendChild(
          button('btn small', 'Sell level', () => send({ type: 'sell_building', spaceId }), {
            disabled: !canManage || level <= 0,
          }),
        );
      }
      if (state.settings.property.mortgageEnabled) {
        if (prop?.mortgaged) {
          actions.appendChild(
            button('btn small warn', 'Lift mortgage', () => send({ type: 'unmortgage', spaceId }), {
              disabled: !canManage,
            }),
          );
        } else {
          actions.appendChild(
            button('btn small', 'Mortgage', () => send({ type: 'mortgage', spaceId }), {
              disabled: !canManage || level > 0,
            }),
          );
        }
      }
      body.appendChild(actions);
      if (state.turn.playerId !== me.id) {
        body.appendChild(el('span', { class: 'hint' }, 'Building and mortgaging happen on your own turn.'));
      }
    }
  } else if (space.amount !== undefined) {
    body.appendChild(
      el(
        'div',
        { class: 'row' },
        el('span', { class: 'tiny-label' }, space.type === 'bonus' ? 'Pays out' : 'Charge'),
        el('span', { class: 'spacer' }),
        el('b', { class: 'money' }, money(space.amount)),
      ),
    );
  }

  return el('div', { class: 'deed' }, head, body);
}
