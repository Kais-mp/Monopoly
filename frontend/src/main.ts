/**
 * Application entry point.
 *
 * Wires the socket, the store, the 3D world and the screen router together.
 * The client is a renderer for authoritative state: nothing in here decides a
 * game outcome.
 */
import './ui/styles.css';
import type { ClientAction } from '@shared/protocol';
import type { PieceId } from '@shared/types';
import { client } from './net/client';
import { store } from './store';
import { applyDocumentPrefs, clearSeat, loadSeat, prefs, saveSeat } from './prefs';
import { audio, sfx } from './audio/audio';
import { World } from './three/world';
import { MenuScreen } from './ui/menu';
import { LobbyScreen } from './ui/lobby';
import { GameUI } from './ui/game';
import { VictoryOverlay } from './ui/victory';
import { toast } from './ui/toasts';
import { clear } from './ui/dom';

applyDocumentPrefs();

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const boot = document.getElementById('boot');

/* ------------------------------------------------------------------ */
/* 3D world                                                            */
/* ------------------------------------------------------------------ */

let world: World | null = null;
try {
  world = new World(canvas);
  world.start();
} catch (error) {
  console.error('WebGL failed to start', error);
  toast('3D could not start on this device. The game will still work.', 'bad', 8000);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function send(action: ClientAction): Promise<void> {
  const result = await client.send(action);
  if (!result.ok && result.error) {
    toast(result.error, 'bad');
    sfx('error');
  }
}

function leaveGame(): void {
  client.leave();
  clearSeat();
  store.reset();
  world?.clearTable();
  world?.resetCamera();
  render();
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

let menu: MenuScreen | null = null;
let lobby: LobbyScreen | null = null;
let game: GameUI | null = null;
let victory: VictoryOverlay | null = null;
let mounted: 'menu' | 'lobby' | 'game' | null = null;

function ensureMenu(): MenuScreen {
  if (!menu) {
    menu = new MenuScreen({
      onCreate: async (name, piece) => {
        const res = await client.createRoom(name, piece as PieceId);
        if (!res.ok) {
          menu?.setError(res.error ?? 'Could not create the game.');
          return;
        }
        onSeated(res.roomCode!, res.playerId!, res.token!);
      },
      onJoin: async (code, name, piece) => {
        const res = await client.joinRoom(code, name, piece as PieceId);
        if (!res.ok) {
          menu?.setError(res.error ?? 'Could not join that game.');
          return;
        }
        onSeated(res.roomCode!, res.playerId!, res.token!);
      },
      onQualityChange: () => world?.applyQualityChange(),
    });
  }
  return menu;
}

function onSeated(roomCode: string, playerId: string, token: string): void {
  store.youId = playerId;
  store.roomCode = roomCode;
  saveSeat({ roomCode, token, playerId });
  sfx('join');
}

function render(): void {
  const screen = store.screen;
  const want = screen === 'lobby' ? 'lobby' : screen === 'game' || screen === 'finished' ? 'game' : 'menu';

  if (want !== mounted) {
    clear(uiRoot);
    mounted = want;
    if (want === 'menu') {
      menu = null;
      lobby = null;
      if (game) {
        game.destroy();
        game = null;
      }
      victory = null;
      uiRoot.appendChild(ensureMenu().el);
      world?.setCinematic(true);
    } else if (want === 'lobby') {
      lobby = new LobbyScreen({ send: (a) => void send(a), onLeave: leaveGame });
      uiRoot.appendChild(lobby.el);
      world?.setCinematic(true);
    } else {
      game = new GameUI({
        send: (a) => void send(a),
        onLeave: leaveGame,
        onQualityChange: () => world?.applyQualityChange(),
      });
      if (world) game.attachWorld(world);
      uiRoot.appendChild(game.el);
      world?.setCinematic(false);
    }
  }

  if (mounted === 'lobby') lobby?.update();
  if (mounted === 'game') {
    game?.update();
    if (store.screen === 'finished') {
      if (!victory) {
        victory = new VictoryOverlay((a) => void send(a), leaveGame);
        uiRoot.appendChild(victory.el);
      }
      victory.update();
    } else if (victory) {
      victory.el.remove();
      victory = null;
    }
  }
}

store.subscribe(render);

/* ------------------------------------------------------------------ */
/* Socket wiring                                                       */
/* ------------------------------------------------------------------ */

client.on('state', (payload) => {
  store.applyState(payload);
  world?.setState(payload.state, store.youId);
  if (payload.fx.length > 0) world?.enqueue(payload.fx);
});

client.on('you', (payload) => {
  store.youId = payload.playerId;
  store.roomCode = payload.roomCode;
  saveSeat({ roomCode: payload.roomCode, token: payload.token, playerId: payload.playerId });
  store.emit();
});

client.on('chat', (message) => {
  store.pushChat(message);
  if (message.kind === 'chat' && message.playerId !== store.youId) sfx('chat', 400);
});

client.on('chatlog', (messages) => store.setChatLog(messages));

client.on('error', (message) => {
  toast(message, 'bad');
  sfx('error');
});

client.on('closed', (reason) => {
  toast(reason, 'warn', 6000);
  clearSeat();
  store.reset();
  world?.clearTable();
  render();
});

client.on('status', (status) => {
  const previous = store.connection;
  store.connection = status;
  if (status === 'connected' && previous === 'reconnecting') toast('Reconnected.', 'good');
  store.emit();
});

/* ------------------------------------------------------------------ */
/* World hooks                                                         */
/* ------------------------------------------------------------------ */

world?.setHooks({
  onPresent: (fx) => game?.present(fx),
  onSpaceClick: (spaceId) => {
    if (store.screen !== 'game' && store.screen !== 'finished') return;
    game?.inspectSpace(spaceId);
  },
  onSpaceHover: (spaceId, x, y) => game?.showTooltip(spaceId, x, y),
  onIdle: () => store.emit(),
});

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

// Audio has to start from a user gesture.
const unlockAudio = () => {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (store.screen !== 'game') return;
  const state = store.state;
  if (!state) return;

  switch (ev.key.toLowerCase()) {
    case 'r':
      if (store.isMyTurn() && state.turn.phase === 'awaiting_roll') void send({ type: 'roll_dice' });
      break;
    case 'e':
      if (store.isMyTurn() && state.turn.phase === 'awaiting_end') void send({ type: 'end_turn' });
      break;
    case 'c':
      store.setDrawer('chat');
      break;
    case 't':
      store.setDrawer('trade');
      break;
    case 'p':
      store.setDrawer('holdings');
      break;
    case ' ':
      world?.resetCamera();
      ev.preventDefault();
      break;
    case 'escape':
      store.setDrawer(null);
      break;
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boothandshake(): Promise<void> {
  client.connect();
  const seat = loadSeat();
  if (seat) {
    const res = await client.resume(seat.roomCode, seat.token);
    if (res.ok) {
      store.youId = res.playerId ?? seat.playerId;
      store.roomCode = res.roomCode ?? seat.roomCode;
      toast('Welcome back — rejoining your game.', 'good');
      sfx('join');
    } else {
      clearSeat();
      store.setScreen('menu');
    }
  } else {
    store.setScreen('menu');
  }
  render();
  window.setTimeout(() => {
    boot?.classList.add('gone');
    window.setTimeout(() => boot?.remove(), 600);
  }, 260);
}

void boothandshake();

// Keep the piece thumbnails and the board in sync with preference changes.
void prefs;
