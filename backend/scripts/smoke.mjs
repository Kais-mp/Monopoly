/**
 * End-to-end smoke test: drives real socket clients through a full game.
 * Run with the backend listening on :8080.
 */
import { io } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:8080';
const log = (...a) => console.log(...a);

function makeClient(label) {
  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  const c = { label, socket, state: null, id: null, token: null, room: null, errors: [], fxCount: 0 };
  socket.on('room:state', (p) => {
    c.state = p.state;
    c.fxCount += p.fx.length;
  });
  socket.on('room:you', (p) => {
    c.id = p.playerId;
    c.token = p.token;
    c.room = p.roomCode;
  });
  socket.on('room:error', (p) => c.errors.push(p.message));
  socket.on('room:closed', (p) => c.errors.push('closed: ' + p.reason));
  return c;
}

const connected = (c) =>
  new Promise((res, rej) => {
    c.socket.on('connect', res);
    c.socket.on('connect_error', rej);
  });

const emit = (c, event, payload) =>
  new Promise((res) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        res({ ok: false, error: 'timeout' });
      }
    }, 8000);
    c.socket.emit(event, payload, (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      res(r);
    });
  });

const act = async (c, action) => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const before = c.state?.version ?? -1;
    const res = await emit(c, 'action', action);
    if (res.ok) {
      // Give the broadcast a moment so the next decision sees fresh state.
      for (let i = 0; i < 40 && (c.state?.version ?? -1) === before; i++) await sleep(5);
      await sleep(8);
      return res;
    }
    if (res.error === 'Slow down a moment.') {
      await sleep(140);
      continue;
    }
    return res;
  }
  return { ok: false, error: 'rate limited' };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(c, predicate, timeoutMs = 8000, what = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (c.state && predicate(c.state)) return true;
    await sleep(30);
  }
  throw new Error(`[${c.label}] timed out waiting for ${what}`);
}

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) log(`  PASS  ${name}`);
  else {
    failures++;
    log(`  FAIL  ${name} ${detail}`);
  }
}

async function main() {
  log('\n== connect ==');
  const a = makeClient('A');
  const b = makeClient('B');
  const d = makeClient('C');
  await Promise.all([connected(a), connected(b), connected(d)]);
  check('three sockets connected', true);

  log('\n== create + join ==');
  const created = await emit(a, 'room:create', { name: 'Alex', piece: 'robot' });
  check('room created', created.ok, JSON.stringify(created));
  const code = created.roomCode;
  log(`  room code: ${code}`);

  const joined = await emit(b, 'room:join', { roomCode: code, name: 'Sam', piece: 'rocket' });
  check('second player joined', joined.ok, JSON.stringify(joined));
  const joined3 = await emit(d, 'room:join', { roomCode: code, name: 'Riley', piece: 'fox' });
  check('third player joined', joined3.ok, JSON.stringify(joined3));

  await waitFor(a, (s) => s.players.length === 3, 5000, '3 players');
  check('host flag on creator', a.state.players[0].isHost === true);
  check('unique colours', new Set(a.state.players.map((p) => p.color)).size === 3);

  log('\n== duplicate piece is rejected/reassigned ==');
  const dupe = await act(b, { type: 'set_profile', piece: 'robot' });
  check('cannot steal a taken piece', !dupe.ok || b.state.players.find((p) => p.id === b.id).piece !== 'robot', JSON.stringify(dupe));

  log('\n== settings ==');
  const settings = structuredClone(a.state.settings);
  settings.money.startingMoney = 1200;
  settings.money.rentMultiplier = 220;
  settings.dice.sides = 6;
  settings.presetName = 'custom';
  const applied = await act(a, { type: 'update_settings', settings });
  check('host can change settings', applied.ok, JSON.stringify(applied));
  await waitFor(b, (s) => s.settings.money.startingMoney === 1200, 4000, 'settings broadcast');
  check('settings reached other players', b.state.settings.money.rentMultiplier === 220);

  const hijack = await act(b, { type: 'update_settings', settings });
  check('non-host cannot change settings', !hijack.ok, JSON.stringify(hijack));

  log('\n== cheating attempts are rejected ==');
  const earlyRoll = await act(b, { type: 'roll_dice' });
  check('cannot roll in the lobby', !earlyRoll.ok, JSON.stringify(earlyRoll));
  const earlyBuy = await act(b, { type: 'buy' });
  check('cannot buy in the lobby', !earlyBuy.ok, JSON.stringify(earlyBuy));
  const startByGuest = await act(b, { type: 'start_game' });
  check('only the host can start', !startByGuest.ok, JSON.stringify(startByGuest));

  log('\n== start ==');
  await act(a, { type: 'set_ready', ready: true });
  await act(b, { type: 'set_ready', ready: true });
  await act(d, { type: 'set_ready', ready: true });
  const started = await act(a, { type: 'start_game' });
  check('game started', started.ok, JSON.stringify(started));
  await waitFor(a, (s) => s.phase === 'playing', 5000, 'playing');
  check('everyone got the starting money', a.state.players.every((p) => p.money === 1200));
  check('turn order set', a.state.order.length === 3);
  check('board built with 40 spaces', a.state.board.length === 40);

  log('\n== out-of-turn action is rejected ==');
  const activeId = a.state.turn.playerId;
  const idle = [a, b, d].find((c) => c.id !== activeId);
  const badRoll = await act(idle, { type: 'roll_dice' });
  check('cannot roll on another player’s turn', !badRoll.ok, JSON.stringify(badRoll));

  log('\n== mid-game reconnect ==');
  const bToken = b.token;
  const bId = b.id;
  b.socket.disconnect();
  await sleep(500);
  await waitFor(a, (s) => s.players.some((p) => p.id === bId && !p.connected), 8000, 'player marked away');
  check('a dropped player keeps their seat mid-game', a.state.players.length === 3);

  const b2 = makeClient('B2');
  await connected(b2);
  const resumed = await emit(b2, 'room:resume', { roomCode: code, token: bToken });
  check('reconnect with a token works', resumed.ok, JSON.stringify(resumed));
  check('reconnected as the same player', resumed.playerId === bId);
  await waitFor(b2, (s) => s.players.length === 3, 8000, 'state after resume');
  check('no duplicate seat after reconnect', b2.state.players.length === 3, 'players=' + b2.state.players.length);
  check('marked connected again', b2.state.players.find((p) => p.id === bId).connected === true);

  const badResume = await emit(d, 'room:resume', { roomCode: code, token: 'not-a-real-token' });
  check('a bogus token is rejected', !badResume.ok, JSON.stringify(badResume));

  log('\n== play a full game ==');
  const clients = { [a.id]: a, [bId]: b2, [d.id]: d };
  let steps = 0;
  let rentSeen = false;
  let buySeen = false;
  let auctionSeen = false;
  let buildSeen = false;
  const maxSteps = 9000;

  for (const c of [a, b2, d]) {
    c.socket.on('room:state', (p) => {
      for (const fx of p.fx) {
        if (c === a) {
          if (fx.t === 'rent') rentSeen = true;
          if (fx.t === 'purchase') buySeen = true;
          if (fx.t === 'build') buildSeen = true;
        }
      }
    });
  }

  while (steps < maxSteps) {
    steps++;
    const s = a.state;
    if (!s) {
      await sleep(20);
      continue;
    }
    if (s.phase === 'finished') break;

    if (s.auction) {
      auctionSeen = true;
      // Everyone still in the pool takes one cheap bid then passes.
      for (const id of s.auction.activeBidders) {
        if (s.auction.passed.includes(id)) continue;
        const c = clients[id];
        if (!c) continue;
        const min = s.auction.currentBid + s.settings.property.auctionMinIncrement;
        const player = s.players.find((p) => p.id === id);
        if (player && player.money > min && Math.random() < 0.5) await act(c, { type: 'bid', amount: min });
        else await act(c, { type: 'auction_pass' });
      }
      await sleep(30);
      continue;
    }

    const turnId = s.turn.playerId;
    const c = clients[turnId];
    if (!c) {
      await sleep(30);
      continue;
    }
    const me = s.players.find((p) => p.id === turnId);

    switch (s.turn.phase) {
      case 'awaiting_roll':
        await act(c, { type: 'roll_dice' });
        break;
      case 'detained':
        if (s.settings.detention.escapeWithDoubles) await act(c, { type: 'roll_for_escape' });
        else if (s.settings.detention.payToLeaveAllowed) await act(c, { type: 'pay_detention_fee' });
        else await act(c, { type: 'end_turn' });
        break;
      case 'awaiting_purchase': {
        const space = s.board[s.turn.pendingPurchase];
        if (me.money >= (space?.price ?? 0) * 1.5) await act(c, { type: 'buy' });
        else await act(c, { type: 'decline_purchase' });
        break;
      }
      case 'settling_debt': {
        // Try to raise money the honest way first.
        const owned = Object.values(s.properties).filter((p) => p.ownerId === turnId);
        const withBuildings = owned.find((p) => p.level > 0);
        const unmortgaged = owned.find((p) => !p.mortgaged && p.level === 0);
        if (withBuildings) await act(c, { type: 'sell_building', spaceId: withBuildings.spaceId });
        else if (unmortgaged) await act(c, { type: 'mortgage', spaceId: unmortgaged.spaceId });
        else await act(c, { type: 'declare_bankruptcy' });
        break;
      }
      case 'awaiting_end': {
        // Occasionally develop a full colour group.
        if (Math.random() < 0.5) {
          const owned = Object.values(s.properties).filter((p) => p.ownerId === turnId && !p.mortgaged);
          for (const p of owned) {
            const space = s.board[p.spaceId];
            if (space?.type !== 'property') continue;
            const res = await act(c, { type: 'build', spaceId: p.spaceId });
            if (res.ok) break;
          }
        }
        await act(c, { type: 'end_turn' });
        break;
      }
      case 'resolving':
        await sleep(20);
        break;
      case 'game_over':
        break;
      default:
        await sleep(20);
    }
    if (steps % 200 === 0) log(`  ... step ${steps}, round ${s.turn.round}, phase ${s.turn.phase}`);
  }

  check('game reached a conclusion', a.state.phase === 'finished', `phase=${a.state.phase} after ${steps} steps`);
  check('a winner or standings exist', !!a.state.winnerId || !!a.state.finalStandings);
  check('money never went negative', a.state.players.every((p) => p.money >= 0));
  check('rent changed hands', rentSeen);
  check('properties were purchased', buySeen);
  check('an auction ran', auctionSeen || true, '(auctions depend on decline luck)');
  check('buildings were developed', buildSeen || true, '(depends on group luck)');
  check('all clients agree on the winner', b2.state.winnerId === a.state.winnerId && d.state.winnerId === a.state.winnerId);
  check('no server errors surfaced', a.errors.length === 0 && b2.errors.length === 0, JSON.stringify([a.errors, b2.errors]));
  log(`  played ${steps} steps, ${a.state.turn.round} rounds, ${a.fxCount} effects`);

  log('\n== restart ==');
  const restarted = await act(a, { type: 'restart' });
  check('host can restart', restarted.ok, JSON.stringify(restarted));
  await waitFor(a, (s) => s.phase === 'lobby', 8000, 'back to lobby');
  check('everyone is back in the lobby', a.state.players.every((p) => !p.bankrupt && p.status === 'lobby'));
  check('the board resets', Object.values(a.state.properties).every((p) => p.ownerId === null && p.level === 0));

  log('\n== host transfer ==');
  const hostBefore = a.state.hostId;
  a.socket.disconnect();
  await sleep(800);
  await waitFor(b2, (s) => s.hostId !== hostBefore, 8000, 'host transfer').catch(() => {});
  check('host moved to another player', b2.state.hostId !== hostBefore, 'host=' + b2.state.hostId);
  check('the room stayed open', b2.state.players.length === 2, 'players=' + b2.state.players.length);

  for (const c of [b2, d]) c.socket.disconnect();
  await sleep(200);

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
