/** Shared 3D piece chooser, used on the create screen and in the lobby. */
import { PIECES, type PieceId } from '@shared/types';
import { piecePreview } from '../three/pieces';
import { button, clear, el } from './dom';
import { sfx } from '../audio/audio';

const previewCache = new Map<string, HTMLCanvasElement>();

function preview(pieceId: PieceId, color: string): HTMLCanvasElement {
  const key = `${pieceId}|${color}`;
  let canvas = previewCache.get(key);
  if (!canvas) {
    canvas = piecePreview(pieceId, color, 128);
    previewCache.set(key, canvas);
  }
  // The same thumbnail may be shown twice, so hand out a copy.
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

export interface PickerOptions {
  selected: PieceId;
  taken: PieceId[];
  color: string;
  onSelect: (piece: PieceId) => void;
  disabled?: boolean;
}

export function renderPiecePicker(host: HTMLElement, options: PickerOptions): void {
  clear(host);
  host.className = 'pieces';
  for (const piece of PIECES) {
    const isTaken = options.taken.includes(piece.id) && piece.id !== options.selected;
    const selected = options.selected === piece.id;
    const node = button(
      `piece-opt${selected ? ' selected' : ''}${isTaken ? ' taken' : ''}`,
      '',
      () => {
        if (isTaken || options.disabled) return;
        sfx('click');
        options.onSelect(piece.id);
      },
      { disabled: isTaken || options.disabled, title: piece.blurb },
    );
    node.appendChild(preview(piece.id, selected ? options.color : '#7f94b0'));
    node.appendChild(el('span', null, piece.name));
    host.appendChild(node);
  }
}
