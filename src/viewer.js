import express from 'express';
import { completed } from './microgoals.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import blockLoader from 'prismarine-block';
import chunkLoader from 'prismarine-chunk';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('prismarine-viewer'));
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');
const renderVersion = '1.21.4';

export function makeDisplayMapper(sourceVersion) {
  const SourceBlock = blockLoader(sourceVersion);
  const TargetBlock = blockLoader(renderVersion);
  const targetData = minecraftData(renderVersion);
  const SourceChunk = chunkLoader(sourceVersion);
  const TargetChunk = chunkLoader(renderVersion);
  const cache = new Map();
  function state(id) {
    if (cache.has(id)) return cache.get(id);
    const block = SourceBlock.fromStateId(id, 0);
    const target = targetData.blocksByName[block.name];
    let value = targetData.blocksByName.stone.defaultState;
    if (target) {
      try { value = TargetBlock.fromProperties(target.id, block.getProperties(), 0).stateId; }
      catch { value = target.defaultState; }
    } else if (block.boundingBox === 'empty') value = targetData.blocksByName.air.defaultState;
    cache.set(id, value); return value;
  }
  function chunk(json) {
    if (sourceVersion === renderVersion) return json;
    const source = SourceChunk.fromJson(json);
    const target = new TargetChunk({ minY: source.minY, worldHeight: source.worldHeight });
    const p = new Vec3(0,0,0);
    for (let y = source.minY; y < source.minY + source.worldHeight; y++) {
      p.y = y;
      for (let z = 0; z < 16; z++) {
        p.z = z;
        for (let x = 0; x < 16; x++) { p.x = x; const id = state(source.getBlockStateId(p)); if (id) target.setBlockStateId(p, id); }
      }
    }
    return target.toJson();
  }
  return { state, chunk };
}

export function viewerState(bot, memory) {
  const current = memory.current ? {...memory.current} : null;
  if (current && bot.entity) {
    current.position = {...bot.entity.position};
    current.health = bot.health; current.food = bot.food;
    current.heldItem = bot.heldItem?.name || null;
    current.inventory = {};
    for (const item of bot.inventory.items()) current.inventory[item.name] = (current.inventory[item.name] || 0) + item.count;
    current.equipped = [5,6,7,8].map(slot => bot.inventory.slots[slot]?.name).filter(Boolean);
  }
  const plan = memory.plan;
  return {current, plan, planner:memory.plannerStatus, activeAction:memory.activeAction,
    completion:(plan?.completion || []).map(condition => ({...condition, satisfied:!!current && completed({...plan,completion:[condition]},current)})),
    recent:(memory.recent || []).slice(-8), milestones:memory.milestones, nativeVersion:bot.version, renderVersion};
}

export async function startViewer(bot, { port = 3007, memory, viewDistance = 3, plannerStatus }) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server);
  const mapper = makeDisplayMapper(bot.version);
  const html = readFileSync(join(root, 'public/index.html'), 'utf8')
    .replace('<title>Prismarine Viewer</title>', '<title>Jev • Live POV</title>')
    .replace('</body>', '<script src="/recorder.js"></script></body>');
  app.get('/', (_, res) => res.type('html').send(html));
  app.get('/recorder.js', (_, res) => res.sendFile(join(import.meta.dirname, '../viewer/recorder.js')));
  app.get('/state', (_, res) => res.json({...viewerState(bot, memory), ...(plannerStatus ? {planner:plannerStatus()} : {})}));
  app.use(express.static(join(root, 'public')));
  io.on('connection', socket => {
    socket.emit('version', renderVersion);
    // Adapt rendering packets only. The bot keeps its native registry/world.
    const emitter = {
      // Read-only spectator view: ignore game-canvas clicks.
      on: () => {},
      emit: (event, packet) => {
        if (event === 'loadChunk') packet = { ...packet, chunk: mapper.chunk(packet.chunk) };
        if (event === 'blockUpdate') packet = { ...packet, stateId: mapper.state(packet.stateId) };
        socket.emit(event, packet);
      }
    };
    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, emitter);
    const move = () => {
      if (!bot.entity || !socket.connected) return;
      socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, addMesh: false });
      worldView.updatePosition(bot.entity.position).catch(() => {});
    };
    worldView.listenToBot(bot);
    worldView.init(bot.entity.position).then(move).catch(error => socket.emit('viewerError', error.message));
    bot.on('move', move);
    const dimensionChanged = () => socket.emit('dimensionChanged');
    bot.on('respawn', dimensionChanged);
    socket.on('disconnect', () => {
      bot.removeListener('move', move); bot.removeListener('respawn', dimensionChanged);
      worldView.removeListenersFromBot(bot);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => { io.emit('runEnded'); io.close(); server.close(); } };
}
