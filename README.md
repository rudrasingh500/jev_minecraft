# Jev Minecraft Runner

> An experimental Minecraft Java survival bot that tries to defeat the Ender Dragon.

Jev is a personal side project exploring autonomous game agents. It connects to a Minecraft Java world through [Mineflayer](https://github.com/PrismarineJS/mineflayer), observes the world and its own state, chooses from a menu of implemented actions, and executes those actions without human control.

The bot exposes general Minecraft interaction skills for the agent to compose toward its objective. It does not contain a fixed progression script; the current controller is deliberately open-ended and experimental. The project also includes a local browser viewer, persistent world memory, structured run logs, and an optional GPT-5.6 Luna planner for longer-term milestones.

**Status: experimental.** This is not a verified autonomous speedrunner. A run can get stuck, die, or fail to finish the game. The project is best treated as a research toy and an evolving side project.

## What it does

- Connects to a local or remote Minecraft Java server as `JevRunner`.
- Maintains one fixed objective: **beat the Ender Dragon**.
- Selects immediate actions from code-defined, currently legal capabilities.
- Uses pathfinding, inventory checks, safety checks, cooldowns, and action timeouts.
- Lets the agent compose generic skills instead of following a hard-coded resource or portal route.
- Persists landmarks, routes, milestones, failures, and action outcomes between runs.
- Optionally asks GPT-5.6 Luna to suggest meaningful multi-action milestones.
- Serves a reconstructed first-person view and live bot state at `http://localhost:3007`.
- Records JSONL logs without writing API keys to disk.

## What it does not do

Jev does not generate or execute code, use creative mode, issue chat commands, use `/locate`, or control the human player's Minecraft client. It does not promise a reliable completion on arbitrary seeds. Navigation cannot tunnel downward or build vertical towers, and combat and bow aiming are intentionally approximate.

## Requirements

- Node.js 22 or newer
- Minecraft Java Edition
- A Minecraft world opened to LAN, or a server the bot is allowed to join
- A `TYPESAFE_API_KEY` for action decisions
- An `OPENAI_API_KEY` if you want the optional Luna planner

The bot itself is a Node.js process, so the main workflow works on **Windows, macOS, and Linux**. On Windows, use PowerShell or Command Prompt with the commands below. The included `start.command` is only a convenience launcher for zsh-compatible shells; it is not required.

## Quick start

### 1. Install dependencies

```sh
npm ci
```

### 2. Create your environment file

```sh
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Open `.env` and add your API keys. Keep this file private; it is ignored by Git.

### 3. Start Minecraft

Open a Minecraft Java world to LAN and note the port shown in chat. Keep the world open while Jev is running.

For offline-mode LAN worlds, the defaults are usually enough. If the LAN port is not `25565`, set `MC_PORT` in `.env`.

### 4. Run the bot

```sh
npm start
```

The same command works in Windows PowerShell and Command Prompt. You can also run the entry point directly:

```sh
node --env-file=.env src/main.js
```

After the bot joins, open [http://localhost:3007](http://localhost:3007) to watch the viewer. The viewer is bound to loopback and is intended for local use.

## Authentication

The default is offline authentication, which is suitable for an offline-capable local server or LAN world:

```dotenv
MC_AUTH=offline
MC_USERNAME=JevRunner
```

For a server that requires Microsoft authentication, use a separate Minecraft-owning account:

```dotenv
MC_AUTH=microsoft
MC_USERNAME=second-account@example.com
```

The first Microsoft login uses a device code and caches credentials in `.auth/`, which is ignored by Git. Do not use the account that is already playing in the world; Minecraft may disconnect the existing player.

## Configuration

All runtime settings are read from `.env`. The complete template is in [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | Required for Jev action decisions |
| `OPENAI_API_KEY` | — | Enables the optional Luna planner |
| `JEV_MODEL` | `jev-latest` | TypeSafe model used for action decisions |
| `MC_HOST` | `localhost` | Minecraft server address |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | `JevRunner` | Bot username or Microsoft account email |
| `MC_AUTH` | `offline` | `offline` or `microsoft` |
| `MC_VERSION` | auto | Force a Minecraft protocol version when needed |
| `WORLD_ID` | `lan-world` | Stable name used to isolate saved memory per world |
| `VIEWER` | `1` | Set to `0` to disable the browser viewer |
| `VIEWER_PORT` | `3007` | Local viewer port |
| `MAX_DECISIONS` | `2000` | Maximum action decisions per run |
| `MAX_MINUTES` | `120` | Maximum run time |
| `DECISION_MS` | `1500` | Delay between decisions |
| `MIN_CONFIDENCE` | `0.2` | Skip choices below this confidence |
| `ACTION_TIMEOUT_MS` | `20000` | Maximum time allowed for one action |

If you reopen the same world on a different LAN port, keep `WORLD_ID` unchanged so Jev can reuse its memory. Use a new `WORLD_ID` for a different world.

## Controls

Type one of these commands into the running terminal:

| Command | Effect |
| --- | --- |
| `pause` | Pause after the current action |
| `resume` | Continue making decisions |
| `status` | Print current counters and state |
| `stop` | Stop and disconnect |
| `Ctrl-C` | Stop and disconnect |

## Capabilities

Jev now makes hierarchical decisions. It first chooses a general skill, then chooses a grounded target from the current world and inventory. Placement adds a material-selection step before coordinates, and crafting or furnace loading can request a quantity of 1, 2, or 4. A single action may therefore require multiple TypeSafe requests and more latency than the previous single-menu controller.

Skills include mining visible harvestable blocks, crafting any currently available recipe, placing held blocks, equipping, wearing, eating, using held items, activating blocks, loading or collecting furnaces, moving toward observed targets, exploring, collecting drops, fleeing, melee, and approximate bow shots. Targets come from the Minecraft registry, inventory, and observed world. Resource quotas, preferred craft lists, mob-hunting quotas, progression gates, and the portal-building blueprint have been removed. The agent must compose these skills into a plan.

Mechanics remain bounded: navigation cannot dig, mining avoids underfoot and adjacent-lava hazards, targets are sampled from nearby loaded blocks and entities, placement uses nearby supported spaces, and actions have deadlines. Arbitrary coordinates, generated code, trading, and general container management are not supported. The controller does not currently verify a complete portal-building sequence or dragon kill.

## How it is organized

```text
src/main.js       Run lifecycle, serialized decision loop, and shutdown
src/jev.js        TypeSafe action-decision client
src/luna.js       Optional GPT-5.6 Luna milestone planner
src/strategy.js   Fixed final objective
src/actions.js    Generic skills, grounded targets, and execution
src/world.js      Minecraft observation and state extraction
src/navigation.js Pathfinder-based movement helpers
src/memory.js     Persistent world memory and action history
src/viewer.js     Browser viewer and live state endpoint
test/             Offline Node.js test suite
viewer/           Browser recording controls
```

Jev owns the immediate skill, target, and quantity choices. Luna, when enabled, works in the background and proposes a single strategic microgoal. Proposals are validated against the latest observed state before they are adopted. A planner failure does not replace the immediate action loop.

## Logs and saved state

Runtime data is intentionally not tracked by Git:

- `logs/` contains `run-*.jsonl` action and lifecycle events.
- `memory/` contains world-specific persistent memory.
- `recordings/` is reserved for saved viewer recordings.
- `.auth/` contains cached Microsoft authentication state.

API keys are redacted from logs as a defense-in-depth measure, but you should still treat local logs and credentials as private.

## Testing

The test suite is offline and does not connect to Minecraft:

```sh
npm test
```

To make one small paid Jev API request and verify the configured action API:

```sh
npm run check:jev
```

The full run requires a live Minecraft world, valid credentials, and the configured API keys.

## Known limitations

- A successful unit test does not prove a full Minecraft run will complete.
- Random seeds and unusual terrain can strand the bot or make required structures hard to find.
- The viewer is a reconstructed view, not a pixel-identical Minecraft client recording.
- The viewer's renderer maps native 26.1 blocks to 1.21.4 display assets; unsupported blocks may render as stone or air.
- Death cancels the current action and invalidates outstanding decisions. The bot stays connected and automatically respawns, then re-observes inventory and requests fresh background advice. The attempt is logged as a death; the overall run time and decision limits still apply.
- The bot is not designed or authorized for public servers without their owner's permission.

## References

- [Mineflayer](https://github.com/PrismarineJS/mineflayer)
- [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)
- [Prismarine Viewer](https://github.com/PrismarineJS/prismarine-viewer)
- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe model primitives](https://docs.typesafe.ai/primitives)

## License

No license has been added yet. Until a license is included, assume the repository is all rights reserved.

Exploration uses recent actual arrival positions to avoid reversing into visited areas when an unseen direction is available. If all directions were visited, least-revisited options remain available; explicit movement to remembered targets and fleeing are unaffected. Jev receives a compact loop summary. Repeated interactions with unchanged block/held-item state and no inventory change are temporarily suppressed after two attempts. Navigation checks that its requested goal was actually reached.
