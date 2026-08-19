/** Transient corner messages for action results and room events. */
import { el } from './dom';

type Kind = 'info' | 'good' | 'bad' | 'warn';

let host: HTMLElement | null = null;
const recent = new Map<string, number>();

function container(): HTMLElement {
  if (!host) host = document.getElementById('toasts');
  return host ?? document.body;
}

export function toast(text: string, kind: Kind = 'info', ttl = 3200): void {
  if (!text) return;
  // Collapse identical messages fired in quick succession.
  const now = Date.now();
  const last = recent.get(text) ?? 0;
  if (now - last < 900) return;
  recent.set(text, now);
  if (recent.size > 40) recent.clear();

  const node = el('div', { class: `toast ${kind === 'info' ? '' : kind}`.trim() }, text);
  const parent = container();
  parent.appendChild(node);
  while (parent.childElementCount > 4) parent.firstElementChild?.remove();

  window.setTimeout(() => {
    node.classList.add('out');
    window.setTimeout(() => node.remove(), 340);
  }, ttl);
}
