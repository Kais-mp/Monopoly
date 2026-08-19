/**
 * Player-local options: audio, accessibility and camera behaviour.
 *
 * None of these touch the rules, so they are available from the menu and
 * mid-game without any server round trip.
 */
import { prefs, setPref, type Quality } from '../prefs';
import { audio, sfx } from '../audio/audio';
import { el } from './dom';

function row(title: string, help: string, control: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'setting' },
    el('div', { class: 'label' }, el('b', null, title), help ? el('small', null, help) : null),
    el('div', { class: 'control' }, control),
  );
}

function toggle(get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    checked: get(),
    on: {
      change: () => {
        set(input.checked);
        sfx('click');
      },
    },
  });
  return input;
}

function slider(get: () => number, set: (v: number) => void): HTMLElement {
  const out = el('output', null, `${Math.round(get() * 100)}%`);
  const range = el('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(get() * 100),
    on: {
      input: () => {
        const v = Number(range.value) / 100;
        out.textContent = `${Math.round(v * 100)}%`;
        set(v);
      },
    },
  });
  return el('div', { class: 'mult' }, range, out);
}

function choose<T extends string>(
  values: { value: T; label: string }[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const select = el('select', {
    on: {
      change: () => {
        set(select.value as T);
        sfx('click');
      },
    },
  });
  for (const v of values) select.appendChild(el('option', { value: v.value, selected: get() === v.value }, v.label));
  return select;
}

export function buildOptionsPanel(onQualityChange?: () => void): HTMLElement {
  const host = el('div', { class: 'col' });

  host.appendChild(el('div', { class: 'tiny-label' }, 'Audio'));
  host.appendChild(
    row(
      'Music',
      'A soft generative harbour pad.',
      toggle(
        () => prefs.musicOn,
        (v) => {
          setPref('musicOn', v);
          audio.unlock();
        },
      ),
    ),
  );
  host.appendChild(row('Music volume', '', slider(() => prefs.musicVolume, (v) => setPref('musicVolume', v))));
  host.appendChild(row('Sound effects', '', toggle(() => prefs.sfxOn, (v) => setPref('sfxOn', v))));
  host.appendChild(row('Effects volume', '', slider(() => prefs.sfxVolume, (v) => setPref('sfxVolume', v))));

  host.appendChild(el('div', { class: 'tiny-label', style: { marginTop: '10px' } }, 'Accessibility'));
  host.appendChild(
    row(
      'Reduced animation',
      'Pieces move almost instantly and idle motion stops.',
      toggle(() => prefs.reducedMotion, (v) => setPref('reducedMotion', v)),
    ),
  );
  host.appendChild(
    row(
      'Reduced effects',
      'Turns off particles, rings and confetti.',
      toggle(() => prefs.reducedEffects, (v) => setPref('reducedEffects', v)),
    ),
  );
  host.appendChild(
    row('High contrast', 'Solid panels and brighter outlines.', toggle(() => prefs.highContrast, (v) => setPref('highContrast', v))),
  );
  host.appendChild(
    row(
      'Interface size',
      '',
      choose(
        [
          { value: 'normal' as const, label: 'Normal' },
          { value: 'large' as const, label: 'Large' },
          { value: 'xl' as const, label: 'Extra large' },
        ],
        () => prefs.uiScale,
        (v) => setPref('uiScale', v),
      ),
    ),
  );

  host.appendChild(el('div', { class: 'tiny-label', style: { marginTop: '10px' } }, 'Display'));
  host.appendChild(
    row(
      'Graphics quality',
      'Lower settings drop shadows, skyline detail and resolution.',
      choose(
        [
          { value: 'high' as Quality, label: 'High' },
          { value: 'medium' as Quality, label: 'Medium' },
          { value: 'low' as Quality, label: 'Low' },
        ],
        () => prefs.quality,
        (v) => {
          setPref('quality', v);
          onQualityChange?.();
        },
      ),
    ),
  );
  host.appendChild(
    row(
      'Follow the active player',
      'The camera drifts to whoever is taking their turn.',
      toggle(() => prefs.followActive, (v) => setPref('followActive', v)),
    ),
  );
  host.appendChild(
    row('Board tooltips', 'Show space details on hover.', toggle(() => prefs.showTooltips, (v) => setPref('showTooltips', v))),
  );

  host.appendChild(
    el(
      'p',
      { class: 'hint', style: { marginTop: '8px' } },
      'Drag to orbit · right-drag or two fingers to pan · scroll or pinch to zoom.',
    ),
  );

  return host;
}
