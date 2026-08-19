/** Minimal declarative DOM builder. Keeps the UI modules free of innerHTML. */

type Child = Node | string | number | null | undefined | false;

interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  title?: string;
  href?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  maxlength?: number;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  autocomplete?: string;
  inputmode?: string;
  rows?: number;
  style?: Partial<CSSStyleDeclaration> & Record<string, string>;
  dataset?: Record<string, string>;
  aria?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: never) => void>>;
  /** Direct property assignment escape hatch (e.g. textContent). */
  props?: Record<string, unknown>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'class':
          node.className = String(value);
          break;
        case 'style':
          for (const [prop, v] of Object.entries(value as Record<string, string>)) {
            // Custom properties have to go through setProperty.
            if (prop.startsWith('--')) node.style.setProperty(prop, v);
            else (node.style as unknown as Record<string, string>)[prop] = v;
          }
          break;
        case 'dataset':
          Object.assign(node.dataset, value);
          break;
        case 'aria':
          for (const [a, v] of Object.entries(value as Record<string, string>)) {
            node.setAttribute(`aria-${a}`, v);
          }
          break;
        case 'on':
          for (const [ev, fn] of Object.entries(value as Record<string, EventListener>)) {
            node.addEventListener(ev, fn);
          }
          break;
        case 'props':
          Object.assign(node, value);
          break;
        case 'disabled':
        case 'checked':
        case 'selected':
          // Boolean properties must be set as properties, not attributes.
          (node as unknown as Record<string, unknown>)[key] = Boolean(value);
          break;
        case 'value':
          (node as unknown as Record<string, unknown>).value = String(value);
          break;
        default:
          node.setAttribute(key, String(value));
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** `el` shorthand for the most common tags. */
export const div = (attrs?: Attrs | null, ...c: Child[]) => el('div', attrs, ...c);
export const span = (attrs?: Attrs | null, ...c: Child[]) => el('span', attrs, ...c);

export function button(
  cls: string,
  label: Child,
  onClick: (ev: MouseEvent) => void,
  opts?: { disabled?: boolean; title?: string },
): HTMLButtonElement {
  return el(
    'button',
    {
      class: cls,
      type: 'button',
      disabled: opts?.disabled,
      title: opts?.title,
      on: { click: onClick as (ev: never) => void },
    },
    label,
  );
}

/**
 * True when the user is typing inside this subtree. Live-updating panels use
 * it to postpone a rebuild rather than yanking the cursor out of a field.
 */
export function hasFocusWithin(node: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  return node.contains(active);
}

/** Swaps a node's children in one shot without touching the node itself. */
export function render(host: Node, ...children: Child[]): void {
  clear(host);
  append(host, children);
}
