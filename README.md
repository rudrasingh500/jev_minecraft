# Jev Minecraft Runner 

This is an experimental side project: an autonomous Minecraft Java survival bot named Jev. Its only objective is **Beat the Ender Dragon**, regardless of inventory, dimension, death, or lost equipment. Jev chooses immediate actions from the implemented action menu using current observations and memory. Mineflayer executes those actions, while TypeSafe's `choice` API selects among the concrete actions currently available to the bot.

The project also includes a lightweight local web viewer for the bot's reconstructed first-person view, optional GPT-5.6 Luna planning for longer-term milestones, persistent world memory, JSONL run logs, and an offline test suite. It intentionally does not use generated code, chat commands, creative inventory, or `/locate` commands.

**This is an unproven speedrun attempt controller, not a verified autonomous speedrunner.** The Jev API connection and automated tests have been checked. A full Minecraft run has not been tested. It can get stuck, die, or fail to complete the game.

## Live viewing, recording, and memory

Run from Terminal (replace the port when LAN changes):

```sh
cd /Users/rudrasingh/Documents/ChatGPT/minecraft_test
./start.command 55286
```

After the bot joins, open http://localhost:3007. Click **Record POV**, then **Stop & download** to save. Video downloads in independent five-minute WebM/MP4 segments to your browser's download location. Allow multiple downloads for long runs. Keep the tab open and visible to avoid browser throttling; save before closing it. This records the game canvas without audio or the status overlay. On a dimension change, stop/save and reload the viewer. `VIEWER=0` disables viewing; `VIEWER_PORT` changes the port.

The renderer maps 26.1 blocks to 1.21.4 assets; newer blocks can appear as stone/air. This is a reconstructed first-person view, not a pixel-identical Minecraft client recording. Gameplay retains native 26.1 data. The viewer only listens on this computer's loopback address.

Memory is saved to `memory/*.json` after actions and at shutdown. It retains last-seen landmarks, explored routes, milestones, action outcomes, inventory/health changes, and repeated failures with increasing retry delays. Jev receives a compact history and nearby remembered places. The bot can return to remembered workstations. Loaded landmarks are revalidated; unloaded ones remain last-seen observations. The JSONL log contains full action outcomes.

Set `WORLD_ID` in `.env` to a different name for each new world; keep it unchanged when reopening the same world on a new LAN port. LAN does not expose a reliable world identity. Memory begins with this update; old runs have not been reconstructed. Historical milestones do not override current inventory after death or item loss.

## Context and agent-selected plans

The sole objective remains **Beat the Ender Dragon**. GPT-5.6 Luna (`gpt-5.6-luna`) selects one microgoal, its rationale, advisory steps, and machine-checkable completion conditions through the OpenAI Responses API. Jev chooses the immediate actions. The OpenAI key is stored only in ignored `.env`; it is never included in world context or logs. OpenAI response storage is disabled.

Luna selects useful multi-action milestones rather than movement destinations or filler-block pickups. Accepted microgoals have a two-minute minimum review interval, including completion (Jev can advance independently while a completed goal waits for review). Recovery reviews require at least five minutes plus eight failures across three distinct actions in the last twelve attempts, or five minutes without measured progress. Dimension changes and important equipment loss trigger review after the minimum interval; twenty minutes is the maximum microgoal lifetime. It is not called on every action. Completion checks support item counts, entering a dimension, observing a monitored landmark nearby, with travel-only and filler-block-only microgoals rejected. Invalid or already-satisfied microgoals are rejected. Plans and their outcomes persist; older Jev tactics are replaced by a Luna microgoal on the next launch. Death still ends the run; a later restart rechecks inventory and the saved microgoal.

The model only plans for implemented bot capabilities. A successful unit/API test does not establish reliable Minecraft completion. API calls incur separate OpenAI and TypeSafe usage; repeated Jev API errors stop the bot. Luna failures are logged while Jev continues independently.
Recent history appears once. Older action outcomes accumulate into up to 200 durable, area-specific lessons with attempt counts, gains, health losses and categorized failures. These are observations rather than guaranteed causal conclusions. Nearby lessons matching the plan and relevant workstations/resources are favored in context. The last eight plans are retained, with the last three supplied as context. The viewer shows the current microgoal below the fixed objective.

Context size is managed locally with a conservative serialized-payload limit. Optional history is trimmed without changing the objective, selected plan, current inventory, or action choices; no budget field or token-management instruction is passed to Jev. This is a byte-based safeguard, not an exact tokenizer. Luna requests and input/output usage are logged separately from Jev requests at shutdown.

## Start on this Mac

Dependencies are already installed, and your supplied key is in `.env` with owner-only permissions. The key is excluded from Git.

1. In Minecraft **Java Edition**, load your world, select **Open to LAN**, and note the port shown in chat. Keep the world open.
2. Double-click `start.command` in this folder (or run `./start.command` in Terminal).
3. Enter that LAN port. The bot joins as `JevRunner` with offline authentication.

Alternatively, set `MC_PORT` in `.env`, then run:

```sh
node --env-file=.env src/main.js
```

The bot is a separate Minecraft player; it does not control your launcher or your player. `localhost` is correct when the LAN world is on this Mac. To join another machine, set `MC_HOST` to its LAN address. LAN ports can change each time you reopen the world.

Offline authentication only works when the host accepts offline players. If the host rejects the bot with an invalid-session or verification error, use an offline-capable private local Java server, or set `MC_AUTH=microsoft` and `MC_USERNAME` to a **second** Minecraft-owning account's email. The first Microsoft connection prompts for device-code authentication and caches the session under ignored `.auth/`. Using the account already playing in the world may disconnect that player.

For a fresh checkout, install Node.js 22+ and run `npm ci`, then copy `.env.example` to `.env` and configure `TYPESAFE_API_KEY` and `OPENAI_API_KEY` securely. Do not commit `.env` or `.auth/`.

## Controls and limits

Type commands in the terminal, followed by Enter:

- `pause`: pause after the current action finishes.
- `resume`: continue making decisions.
- `status`: show counters and status.
- `stop`, or Ctrl-C: stop and disconnect.

The default limits are 2,000 decisions and 120 minutes, whichever comes first. Decisions have a 1.5-second gap after each action. API requests time out after 8 seconds and retry temporary HTTP overload/rate-limit errors up to twice. Repeated API failures stop the run. Death ends the attempt; it does not silently respawn.

An action exceeding `ACTION_TIMEOUT_MS` is cancelled. The controller waits up to three seconds for it to settle, records the failed attempt, and chooses another action. Only an operation that fails to settle after cancellation ends the connection, preventing overlapping actions. Increase this from its 20,000 ms default if ordinary travel or obsidian mining takes longer. Low-confidence choices are skipped quietly and cooled down for ten seconds; `MIN_CONFIDENCE` defaults to 0.2. The status command shows the skipped count. Navigation cancels after eight seconds and allows the controller to try another action. A low-health emergency can override Jev with fleeing or eating.

Logs go to `logs/run-*.jsonl` and include actions, confidence, failures, positions and token counters. They do not include the API key. Limits bound runtime and decision count, not a precise dollar budget; retries can create extra API requests.

## Available capabilities

- Harvest logs, craft planks, sticks, a crafting table and pickaxes.
- Mine stone, coal, iron and diamonds; smelt resources and food.
- Craft/equip tools and armor; hunt, eat, pick up drops and fight threats.
- Mine dry obsidian; assemble a ten-obsidian portal using cobblestone supports and ignite it.
- Explore the Nether, attack nearby blazes and return through the remembered portal.
- Hunt endermen, craft Eyes of Ender, observe thrown-eye trajectories and follow them.
- Fill discovered stronghold frames, enter the End, shoot crystals and dragons, and melee reachable dragons.

The route deliberately uses a diamond pickaxe and mined obsidian instead of an advanced lava-bucket portal technique. It is slower than competitive speedrun routes. It has no fortress/bastion search algorithm beyond exploration, no piglin bartering, no water-bucket obsidian casting, no robust underground stronghold excavation, no pillar-climbing/caged-crystal routine, and no bed one-cycle. Bow aim is approximate. These are significant limits: a general random-seed completion is not assured. Workstations and route memory are persisted between launches.

Only loaded, nearby world observations are available. The pathfinder avoids lava and large drops, but this is not a guarantee of survival. An observed dragon death stops the run; it does not prove the bot got the kill or establish a valid competitive speedrun time.

## Verification

```sh
node --test
node --env-file=.env src/check-jev.js
```

The first command runs offline tests for the API contract, invalid choices, auth errors, retries, cancellation, configuration and progression. The second makes one small paid Jev request, without connecting to Minecraft.

The dependency audit currently reports six moderate advisories in Mineflayer's transitive authentication dependencies. The suggested automatic fix downgrades Mineflayer to an incompatible old version, so it has not been applied.

## References

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe model primitives](https://docs.typesafe.ai/primitives)
- [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)

Implementation: `src/main.js` owns the serialized loop and lifecycle; `src/jev.js` handles TypeSafe; `src/strategy.js` defines the fixed objective and craft candidates; `src/world.js` observes state; `src/actions.js` builds and executes the action menu.

Luna reviews run in the background, with at most one request outstanding and at least two minutes between requests. Jev keeps selecting and executing actions during reviews. Advice is validated against the latest observation and adopted only between actions; advice from a previous dimension is discarded. Luna never cancels movement.

Ordinary pathfinding cannot dig or build vertical towers, and the generic downward-excavation action has been removed. Explicit mining candidates require visible blocks; this can limit access to buried resources. Placed nearby crafting tables and furnaces count toward workstation availability. Jev explicitly reports whether it adopts an advisory goal (`microgoal_established`), finds it blocked, or considers it complete; completion is independently verified against observed state. The final objective remains Beat the Ender Dragon.

The live viewer shows inventory, held item, armor, coordinates, advisory goal acknowledgment and completion checks, background planner status, and recent action outcomes. Expand/collapse the panels as needed. POV recordings capture the game canvas, not the state overlay.

Resource selection counts logs/stems as four planks and stops offering routine wood harvesting at 16 plank-equivalents. Searches filter buried blocks before limiting choices and offer non-destructive approaches to exposed resources outside line of sight. An exposed target is not a guarantee of a reachable path; navigation still has a deadline. Recipe guidance lists missing ingredients for the current advisory inventory goal. Crafting-table revisits require a currently craftable table recipe. Travel alone does not reset the microgoal stall clock.

Timing diagnostics: `decision_started` records observation/action-scan time, `decision_received` records Jev response duration, and action logs include `lunaPending`. The viewer reads Luna's live pending status rather than the last action-boundary snapshot. Restart the terminal process to load code changes; refreshing the viewer alone does not update the runner.

Jev's execution context now centers a single active microgoal, its completion checks, advisory steps, missing recipe ingredients, and current observations. It receives only four recent outcomes, up to three candidate-specific failures, and up to four relevant remembered places. Old plans, aggregate lessons, milestones, and path history remain persisted and available to Luna but are omitted from Jev action requests. Completed microgoals carry no active steps or recipe guidance. Immediate safety and evidence of infeasibility still permit recovery; an active feasible microgoal is the default tactical focus. This changes context selection, not the final objective or background scheduling.
