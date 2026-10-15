import { Vec3 } from 'vec3'
import { subscribe } from 'valtio'
import {
  AppViewer,
  getInitialPlayerState,
  MENU_BACKGROUND_MC_VERSION,
  menuBackgroundOptionsFromStorage,
  type MenuBackgroundOptions
} from 'minecraft-renderer/src'
import { generateGuiAtlas } from 'minecraft-renderer/src/lib/guiRenderer'
import { BotEvents, type EntityMovedMetadata } from 'mineflayer'
import { activeModalStack, miscUiState } from './globalState'
import { options } from './optionsStorage'
import { watchOptionsAfterWorldViewInit } from './watchOptions'
import { updateLightRemeshBlockKey } from './mineflayer/updateLightRemeshKey'
import { buildEntityRenderHints } from './boatRenderHints'

// do not import this. Use global appViewer instead (without window prefix).
export const appViewer = new AppViewer()
appViewer.resourcesManager.generateGuiTextures = async () => {
  await generateGuiAtlas(appViewer)
}
window.appViewer = appViewer

appViewer.onWorldStart = () => {
  connectAppWorldViewToBot()

  if (appViewer.worldView) {
    watchOptionsAfterWorldViewInit(appViewer.worldView)
  }
}

const prepareMenuBackgroundAssets = async (opts: MenuBackgroundOptions) => {
  if (!opts.useMinecraftTextures) return
  const { loadMinecraftData } = await import('./connect')
  await loadMinecraftData(MENU_BACKGROUND_MC_VERSION)
  appViewer.resourcesManager.currentConfig = {
    version: MENU_BACKGROUND_MC_VERSION,
    texturesVersion: options.useVersionsTextures || undefined,
    noInventoryGui: true
  }
  await appViewer.resourcesManager.updateAssetsData({})
}

const initialMenuStart = async () => {
  if (appViewer.currentDisplay === 'world') {
    appViewer.resetBackend(true)
  }
  const demo = new URLSearchParams(window.location.search).get('demo')
  if (!demo) {
    const menuBackgroundOpts = menuBackgroundOptionsFromStorage(options)
    await prepareMenuBackgroundAssets(menuBackgroundOpts)
    appViewer.startMenuBackground(menuBackgroundOpts)
    return
  }

  // const version = '1.18.2'
  const version = '1.21.4'
  const { loadMinecraftData } = await import('./connect')
  const { getSyncWorld } = await import('minecraft-renderer/src/playground/shared')
  await loadMinecraftData(version)
  const world = getSyncWorld(version)
  world.setBlockStateId(new Vec3(0, 64, 0), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(1, 64, 0), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(1, 64, 1), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(0, 64, 1), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(-1, 64, -1), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(-1, 64, 0), loadedData.blocksByName.water.defaultState)
  world.setBlockStateId(new Vec3(0, 64, -1), loadedData.blocksByName.water.defaultState)
  appViewer.resourcesManager.currentConfig = { version }
  appViewer.playerState.reactive = getInitialPlayerState()
  await appViewer.resourcesManager.updateAssetsData({})
  await appViewer.startWorld(world, 3)
  if (appViewer.worldView) watchOptionsAfterWorldViewInit(appViewer.worldView)
  appViewer.backend!.updateCamera(new Vec3(0, 65.7, 0), 0, -Math.PI / 2) // Y+1 and pitch = PI/2 to look down
  void appViewer.worldView!.init(new Vec3(0, 64, 0))
}
window.initialMenuStart = initialMenuStart

const hasAppStatus = () => activeModalStack.some(m => m.reactType === 'app-status')

export const onAppViewerConfigUpdate = () => {
  appViewer.inWorldRenderingConfig.skinTexturesProxy = miscUiState.appConfig?.skinTexturesProxy
}

export const modalStackUpdateChecks = () => {
  if (!miscUiState.gameLoaded && !hasAppStatus()) {
    void initialMenuStart()
  }

  if (appViewer.backend) {
    appViewer.backend.setRendering(!hasAppStatus())
  }

  appViewer.inWorldRenderingConfig.foreground = activeModalStack.length === 0
}
subscribe(activeModalStack, modalStackUpdateChecks)

/** Chunks that received `update_light` before worldView finished the initial load. */
const pendingUpdateLightRelight = new Set<string>()

const connectAppWorldViewToBot = () => {
  const entitiesObjectData = new Map<string, number>()
  const deadEntities = new Set<number>()
  bot._client.prependListener('spawn_entity', (data) => {
    if (data.objectData && data.entityId !== undefined) {
      entitiesObjectData.set(data.entityId, data.objectData)
    }
  })

  // where the game shows the entity this tick: its interpolation's step toward the server's moves while one runs
  // (mineflayer's entityInterpolation), else its position (the server's, or where the client's own physics moved it)
  const shownPosition = (e) => {
    const state = e.interpolation
    return state && (state.steps > 0 || state.minecart) && e.interpolatedPosition ? e.interpolatedPosition : e.position
  }

  const emitEntity = (e, name = 'entity', eventMetadata = {}) => {
    if (!e) return
    if (e === bot.entity) {
      if (name === 'entity') {
        appViewer.worldView?.emit('playerEntity', e)
      }
      return
    }
    if (!e.name) return // mineflayer received update for not spawned entity
    if (deadEntities.has(e.id)) return
    e.objectData = entitiesObjectData.get(e.id)
    const renderHints = buildEntityRenderHints(e, {
      localVehicle: bot.vehicle,
      localBoatStatus: bot._boatPhysics?.getStatus?.() ?? null,
      localBoatPaddleState: bot._boatPhysics?.getPaddleState?.() ?? null,
      horseControllerActive: Boolean(bot._horsePhysics?.getCtx?.()),
      world: bot.world,
      waterIds: {
        waterId: bot.registry.blocksByName.water.id,
        flowingWaterId: bot.registry.blocksByName.flowing_water?.id,
      },
      version: bot.version,
      entityMetadataKeys: bot.registry.entitiesByName[e.name]?.metadataKeys,
    })
    const shown = shownPosition(e)
    appViewer.worldView?.emit(name as any, {
      ...e,
      ...eventMetadata,
      position: shown,
      pos: shown,
      // the position is the shown one of a client tick: the renderer moves to it over one tick, as the game draws
      // between an entity's last two ticks
      tickInterpolated: !!(bot as any).entityInterpolation,
      username: e.username,
      team: bot.teamMap[e.username] || bot.teamMap[e.uuid],
      renderHints,
    })
  }

  const pendingPassengerVehicles = new Map<number, any>()
  let passengerVehicleFlushScheduled = false
  const queuePassengerVehicleRefresh = (vehicle: any) => {
    if (!vehicle) return
    pendingPassengerVehicles.set(vehicle.id, vehicle)
    if (passengerVehicleFlushScheduled) return
    passengerVehicleFlushScheduled = true
    queueMicrotask(() => {
      passengerVehicleFlushScheduled = false
      const vehicles = [...pendingPassengerVehicles.values()]
      pendingPassengerVehicles.clear()
      for (const pendingVehicle of vehicles) {
        emitEntity(pendingVehicle)
      }
    })
  }

  const eventListeners = {
    entitySpawn (e: any) {
      if (e.name === 'item_frame' || e.name === 'glow_item_frame') {
        e.position.translate(0.5, 0.5, 0.5)
      }
      emitEntity(e)
    },
    entityUpdate (e: any) {
      emitEntity(e)
    },
    entityEquip (e: any) {
      emitEntity(e)
    },
    entityMoved (e: any, eventMetadata: EntityMovedMetadata = {}) {
      emitEntity(e, 'entityMoved', eventMetadata)
    },
    entityAttach (_passenger: any, vehicle: any) {
      queuePassengerVehicleRefresh(vehicle)
    },
    entityDetach (_passenger: any, vehicle: any) {
      queuePassengerVehicleRefresh(vehicle)
    },
    entityDead (e: any) {
      if (e === bot.entity) return
      if (deadEntities.has(e.id)) return
      deadEntities.add(e.id)
      appViewer.worldView?.emit('entity', { id: e.id, delete: true })
    },
    entityGone (e: any) {
      deadEntities.delete(e.id)
      appViewer.worldView?.emit('entity', { id: e.id, delete: true })
    },
    chunkColumnLoad (pos: Vec3) {
      const now = performance.now()
      if (appViewer.worldView?.lastChunkReceiveTime) {
        appViewer.worldView.chunkReceiveTimes.push(now - appViewer.worldView.lastChunkReceiveTime)
      }
      appViewer.worldView!.lastChunkReceiveTime = now

      if (appViewer.worldView?.waitingSpiralChunksLoad[`${pos.x},${pos.z}`]) {
        appViewer.worldView?.waitingSpiralChunksLoad[`${pos.x},${pos.z}`](true)
        delete appViewer.worldView?.waitingSpiralChunksLoad[`${pos.x},${pos.z}`]
      } else if (appViewer.worldView?.loadedChunks[`${pos.x},${pos.z}`]) {
        void appViewer.worldView?.loadChunk(pos, false, 'Received another chunkColumnLoad event while already loaded')
      } else {
        void appViewer.worldView?.loadChunk(pos, false, 'chunkColumnLoad')
      }
      appViewer.worldView?.chunkProgress()
    },
    chunkColumnUnload (pos: Vec3) {
      appViewer.worldView?.unloadChunk(pos)
    },
    blockUpdate (oldBlock: any, newBlock: any) {
      const stateId = newBlock.stateId ?? ((newBlock.type << 4) | newBlock.metadata)
      appViewer.worldView?.emit('blockUpdate', { pos: oldBlock.position, stateId })
    },
    time () {
      appViewer.worldView?.emit('time', bot.time.timeOfDay)
    },
    end () {
      appViewer.worldView?.emit('end')
    },
    login () {
      void appViewer.worldView?.updatePosition(bot.entity.position, true)
      appViewer.worldView?.emit('playerEntity', bot.entity)
    },
    respawn () {
      void appViewer.worldView?.updatePosition(bot.entity.position, true)
      appViewer.worldView?.emit('playerEntity', bot.entity)
      appViewer.worldView?.emit('onWorldSwitch')
    },
  } satisfies Partial<BotEvents>


  appViewer.worldView?.on('loadChunk', (data) => {
    if (data.isLightUpdate) return
    const key = `${data.x},${data.z}`
    if (!pendingUpdateLightRelight.delete(key)) return
    void appViewer.worldView?.loadChunk(new Vec3(data.x, 0, data.z), true, 'update_light-pending')
  })

  bot._client.on('update_light', ({ chunkX, chunkZ }) => {
    const key = updateLightRemeshBlockKey(chunkX, chunkZ)
    const bx = chunkX * 16
    const bz = chunkZ * 16
    const waiting = !!appViewer.worldView?.waitingSpiralChunksLoad[key]
    const loaded = !!appViewer.worldView?.loadedChunks[key]
    if (!waiting && loaded) {
      void appViewer.worldView?.loadChunk(new Vec3(bx, 0, bz), true, 'update_light')
    } else if (!loaded) {
      pendingUpdateLightRelight.add(key)
    }
  })

  // before 1.19 paintings spawn with their own packet, which mineflayer keeps out of bot.entities: the title (1.8 - 1.12)
  // or motive id (1.13 - 1.18) is the variant, the direction is 2D, the location the painting's block
  const legacyPaintings = new Set<number>()
  bot._client.on('spawn_entity_painting', (packet) => {
    // the packet is gone from 1.19 (a singleplayer server may still send one, without its fields)
    if (!packet.location) return
    legacyPaintings.add(packet.entityId)
    appViewer.worldView?.emit('entity', {
      id: packet.entityId,
      name: 'painting',
      type: 'object',
      pos: new Vec3(packet.location.x, packet.location.y, packet.location.z),
      paintingVariant: packet.title,
      paintingDirection: packet.direction,
    } as any)
  })
  bot._client.on('entity_destroy', ({ entityIds }) => {
    for (const id of entityIds ?? []) {
      if (legacyPaintings.delete(id)) appViewer.worldView?.emit('entity', { id, delete: true })
    }
  })
  bot.on('respawn', () => legacyPaintings.clear())

  for (const [evt, listener] of Object.entries(eventListeners)) {
    bot.on(evt as any, listener)
  }

  // each client tick the entities step toward the server's moves: those shown somewhere else are drawn there
  const lastShown = new Map<number, string>()
  bot.on('entityInterpolationTick' as any, () => {
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || !e.name) continue
      const { x, y, z } = shownPosition(e)
      const key = `${x},${y},${z}`
      if (lastShown.get(e.id) === key) continue
      lastShown.set(e.id, key)
      emitEntity(e, 'entityMoved', {})
    }
  })
  bot.on('entityGone', (e) => { lastShown.delete(e.id) })

  // eslint-disable-next-line guard-for-in
  for (const id in bot.entities) {
    const e = bot.entities[id]
    try {
      emitEntity(e)
    } catch (err) {
      console.error('error processing entity', err)
    }
  }
}
