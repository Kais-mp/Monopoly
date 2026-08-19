# Aurora Bay

Aurora Bay is a 3D online multiplayer property-trading board game set in an original neon harbour city. It supports private 2–6 player rooms, configurable house rules, live chat, reconnectable seats, auctions, trading, event cards, and a server-authoritative economy.

The frontend renders the current game state and animates presentation effects. The backend owns every rule: clients send intents, the backend validates them, mutates the state, and broadcasts the resulting snapshot.

## Highlights

- 40-space Aurora Bay board with districts, transport lines, utilities, taxes, events, detention, and a rest stop.
- 2–6 players per room, selectable pieces, unique display names, host transfer, ready state, and invite links.
- Classic property flow: buy, auction, build up to towers, sell buildings, mortgage, unmortgage, and collect rent.
- City Pulse event deck with fortune, setback, movement, civic, and chaos cards.
- Optional trading of cash, deeds, and release cards, with support for counters and mortgaged-deed rules.
- Detention, doubles, release cards, debt settlement, automatic liquidation, bankruptcy, and configurable estate handling.
- Victory by last standing, net-worth target, or turn limit.
- Real-time chat, latency indicator, sound effects, animated dice and movement, camera focus, and Three.js board presentation.
- Reconnection tokens preserve a seat during a game. Idle or disconnected turns are automatically advanced.
- Security and operations basics included: Helmet CSP, compression, optional CORS allowlist, JSON limits, per-socket action rate limiting, health checks, and graceful shutdown.

## Repository Layout

```text
backend/
  src/index.ts                 HTTP and Socket.IO host
  src/config.ts               Environment-backed runtime configuration
  src/game/                   Board, rules engine, events, settings, RNG
  src/net/gateway.ts          Socket.IO authentication and message routing
  src/rooms/RoomManager.ts    In-memory room lifecycle and timers
  src/shared/                 Types and client/server protocol contract
  scripts/smoke.mjs           End-to-end multiplayer smoke test
frontend/
  src/main.ts                 Application bootstrap and screen routing
  src/net/                    Socket.IO client and server endpoint helpers
  src/store.ts                Authoritative snapshot store
  src/three/                  Board, pieces, camera, dice, effects, decor
  src/ui/                     Menu, lobby, game HUD, rules, trade, victory UI
  src/audio/                  Generated sound effects and preferences
```

The shared protocol is imported by both applications. The Vite alias `@shared` points the frontend at `backend/src/shared`, keeping wire types in one place.

## Requirements

- Node.js 20 or newer. Node 22 is used by the Azure GitHub Actions workflow.
- npm.
- A browser with WebGL for the full 3D presentation. The game remains usable if WebGL cannot start.

## Local Development

Install both workspaces from the repository root:

```bash
npm run install:all
```

Start the backend in one terminal:

```bash
npm run dev:backend
```

Start Vite in a second terminal:

```bash
npm run dev:frontend
```

Open `http://localhost:5173`. Vite proxies `/api`, `/healthz`, and `/socket.io` to `http://localhost:8080` by default.

To use another backend during frontend development:

```bash
DEV_SERVER_URL=http://localhost:8080 npm run dev:frontend
```

On PowerShell, set the variable for the current session first:

```powershell
$env:DEV_SERVER_URL = 'http://localhost:8080'
npm run dev:frontend
```

The root `dev` script starts both processes through the package manager, but separate terminals are easier to control on Windows.

## Commands

Run these from the repository root unless noted otherwise:

| Command | Purpose |
| --- | --- |
| `npm run install:all` | Install backend and frontend dependencies |
| `npm run typecheck` | Type-check both workspaces |
| `npm test` | Run backend Vitest tests |
| `npm run smoke` | Drive real Socket.IO clients through a full game |
| `npm run build` | Build a standalone frontend and the backend |
| `npm run build:bundled` | Build the frontend into `backend/public`, then build the backend |
| `npm start` | Start the compiled backend |
| `npm run dev:backend` | Run the backend with `tsx watch` |
| `npm run dev:frontend` | Run the Vite development server |

The smoke test expects a running backend on port 8080. Set `SMOKE_URL` to test another URL:

```bash
SMOKE_URL=http://localhost:8080 npm run smoke
```

There are currently no dedicated backend test files required by the suite; the backend test command is configured with `--passWithNoTests`. The smoke test is the main end-to-end verification path.

## Configuration

The backend reads all runtime configuration from environment variables. Defaults are suitable for local use.

| Variable | Default | Description |
| --- | ---: | --- |
| `PORT` | `8080` | HTTP and Socket.IO listening port |
| `NODE_ENV` | `development` | Runtime environment and log format behavior |
| `PUBLIC_DIR` | `backend/public` | Directory containing the built client |
| `CORS_ORIGINS` | empty | Comma-separated additional allowed origins |
| `ROOM_EMPTY_TTL_MINUTES` | `30` | Time before an all-disconnected room is reaped |
| `MAX_ROOMS` | `500` | Maximum rooms held by one process |
| `ROOM_TICK_MS` | `1000` | Room sweep interval |
| `CHAT_HISTORY` | `80` | Maximum chat messages retained per room |
| `RATE_ACTIONS_PER_SECOND` | `12` | Per-socket action refill rate |
| `RATE_BURST` | `30` | Per-socket action burst capacity |
| `LOG_LEVEL` | `info` | Logger level |

Frontend endpoint selection happens at build time:

| Variable | Default | Description |
| --- | --- | --- |
| `DEV_SERVER_URL` | `http://localhost:8080` | Vite proxy target during development |
| `VITE_SERVER_URL` | empty | Separate backend base URL for a static frontend deployment |

When `VITE_SERVER_URL` is empty, the frontend uses same-origin `/api` and `/socket.io`. Remove trailing slashes from the value automatically is handled by the client.

## Gameplay

### Room lifecycle

1. A player creates a room and becomes its host, or joins with a 4–8 character room code.
2. Players choose names and pieces, mark themselves ready, and share the room code or generated invite link.
3. The host selects a preset or edits the rules, then starts once at least two players are present.
4. A randomly shuffled turn order is used. The host can kick players only while the room is in the lobby.
5. After the game finishes, the host can restart the same room with the same players and new rules.

### Turn and economy

Players roll, move around the board, resolve the landing, and buy or decline unowned property. Declined or unaffordable property can enter a timed auction when auctions are enabled. Doubles may grant another roll; too many consecutive doubles can send a player to detention or end the turn depending on the rules.

District ownership enables improved rent. Buildings must obey the configured full-district and even-building requirements. Owners can sell levels and mortgage property to raise cash. If an active player cannot pay, the game enters a debt phase so they can liquidate assets or declare bankruptcy. Other players are liquidated automatically when required.

The host rules editor covers:

- money, prices, rent, taxes, penalties, starting cash, and detention fees;
- dice count, sides, doubles, and movement bonuses;
- building levels, towers, district requirements, mortgages, auctions, and detention rent;
- detention duration, payment, doubles, and release cards;
- Aurora Gardens behavior and the shared pot;
- event frequency, strength, and disabled categories;
- trading permissions and turn restrictions;
- bankruptcy asset destination and mortgage transfer behavior;
- victory mode, wealth target, turn limit, player count, speed, and turn timeout.

Built-in presets are **Classic**, **Chaos**, **Speed Run**, **Tycoon Race**, and **Friendly**. Presets can be loaded in the lobby and then customized. The server sanitizes and clamps every settings update before applying it.

## HTTP API

The backend exposes these lightweight HTTP routes:

| Route | Behavior |
| --- | --- |
| `GET /healthz` | Returns `{ status, uptime, rooms, players, playing }` for health probes |
| `GET /api/presets` | Returns the available rules presets |
| `GET /api/pieces` | Returns selectable player pieces |
| `GET /api/rooms/:code` | Checks room existence and returns phase/player/preset summary |
| `GET /` | Serves the bundled client when `backend/public/index.html` exists |

The backend also serves the Vite build as a single-page application and falls back to `index.html` for non-API, non-Socket.IO routes.

## Socket.IO Contract

Room creation, joining, and resuming use acknowledgements:

- `room:create` with `{ name, piece }`
- `room:join` with `{ roomCode, name, piece, token? }`
- `room:resume` with `{ roomCode, token }`
- `room:leave`

The client sends validated-intent requests through `action`. Supported action types include `set_profile`, `set_ready`, `update_settings`, `start_game`, `roll_dice`, `buy`, `decline_purchase`, `bid`, `auction_pass`, `build`, `sell_building`, `mortgage`, `unmortgage`, detention actions, `end_turn`, trade actions, `declare_bankruptcy`, `chat`, `kick`, and `restart`.

The server broadcasts:

- `room:state` with the complete `GameState` and ordered `GameFx` animation cues;
- `room:chat` and one-time `room:chatlog` messages;
- `room:you` with the player seat and reconnection token;
- `room:closed`, `room:error`, and `pong2` for lifecycle and latency handling.

The client never decides a game outcome locally. Snapshot versions let it discard stale state received during reconnect bursts.

## Deployment

### Single-service Azure App Service

This is the primary deployment shape. It serves the frontend and Socket.IO backend from one origin:

```bash
npm run build:bundled
npm start
```

`npm run build:bundled` writes Vite output to `backend/public`; the backend then serves those files and the realtime API together. The included GitHub Actions workflow performs backend install, typecheck, tests, backend build, bundled frontend build, production dependency pruning, and Azure deployment on pushes to `main` that affect the application.

Configure the workflow’s `AZURE_WEBAPP_NAME` and the repository secret `AZURE_WEBAPP_PUBLISH_PROFILE`. The App Service should run Node 20+ and use the injected `PORT`. Set `NODE_ENV=production` and any desired backend configuration in App Service settings.

Room state is held in process memory. A single App Service instance is therefore the supported topology. Horizontal scaling requires shared room storage, such as Redis, plus the Socket.IO Redis adapter and a replacement for the in-memory room map. ARR affinity alone does not make multi-instance state consistent.

### Static Vercel frontend plus separate backend

Build the frontend normally and deploy `frontend` using its Vercel configuration:

```bash
cd frontend
npm install
npm run build
```

Set `VITE_SERVER_URL` in the Vercel build environment to the public HTTPS URL of the backend, for example `https://game.example.com`. Set `CORS_ORIGINS` on the backend to the Vercel origin. The backend must remain separately deployed and reachable over HTTPS/WebSocket; Vercel’s static output does not host the game server.

## Security and Operations Notes

- All mutating actions are checked against the authenticated seat and current game phase on the backend.
- Names, room codes, pieces, chat text, settings, trade sides, and bids are sanitized or bounded server-side.
- Socket actions use a token-bucket rate limiter. This is flood control, not an identity or abuse-prevention system.
- Reconnection tokens are held only in the process memory of the room that issued them.
- Rooms are destroyed after their TTL when all players are disconnected, or immediately while empty.
- Do not expose a production backend without configuring its allowed origins and HTTPS termination correctly.
- `backend/public` contains generated bundled client assets. Rebuild the frontend when source changes; do not hand-edit generated files.

## License

No license file is currently included in this repository.
