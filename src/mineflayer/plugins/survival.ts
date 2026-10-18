// mineflayer-survival in the browser: the pathfinder and the survival plugin on every bot, driven from chat commands
// (/survival, /goto). The bot is the player's own, so nothing runs until asked: no play and no reflexes until
// /survival start, and a movement key pressed while the bot drives (play or /goto) stops it and hands the controls back.
import type { Bot } from 'mineflayer'
import { createPlugin as createPathfinder, goals } from '@nxg-org/mineflayer-pathfinder'
import { createPlugin as createSurvival, MILESTONES, type MilestoneId, type PlayResult, type SaveStore } from 'mineflayer-survival'
import { proxy, subscribe } from 'valtio'
import { displayClientChat } from '../../botUtils'
import { lastConnectOptions } from '../../appStatus'
import { mineflayerPluginHudState } from '../../react/MineflayerPluginHud'
import { activeModalStack, hideModal, showModal } from '../../globalState'

export const survivalState = proxy({
  /** what drives the bot: survival's play, a /goto, or nothing (the player) */
  driving: null as null | 'survival' | 'goto',
  /** the milestone play works on */
  milestone: null as MilestoneId | null,
  /** the last line of play's log */
  lastLine: '',
  /** the reflexes run while play does (/survival reflexes on|off) */
  reflexes: true,
})

let playAbort: AbortController | null = null

const HUD_ID = 'mineflayer-survival'
const SAVE_PREFIX = 'mineflayer-survival:'

const say = (text: string, color = 'gray') => {
  displayClientChat({ text: '', extra: [{ text: '[survival] ', color: 'gold' }, { text, color }] })
}

const updateHud = () => {
  const ui = mineflayerPluginHudState.ui.filter(u => u.id !== HUD_ID)
  if (survivalState.driving) {
    const what = survivalState.driving === 'goto'
      ? 'goto'
      : `survival: ${survivalState.milestone ?? '...'}${bot?.survival?.tasks?.current ? ` (${bot.survival.tasks.current.name})` : ''}`
    ui.push({ id: HUD_ID, type: 'text', text: `${what} - a movement key stops it`, x: 4, y: 4, motion: false, formatted: false, css: 'color: #fc0; font-size: 10px; text-shadow: 1px 1px #000;' })
  }
  mineflayerPluginHudState.ui = ui
}

/** the save of this server and player, in localStorage (the browser has no fs) */
const saveKey = () => `${SAVE_PREFIX}${lastConnectOptions.value?.server ?? 'local'}:${bot.username}`
const localStorageStore = (key: string): SaveStore => ({
  name: `localStorage ${key}`,
  read: () => localStorage.getItem(key),
  write: (json) => {
    try {
      localStorage.setItem(key, json)
    } catch (err) {
      console.warn('[survival] save failed', err)
    }
  },
})

const setReflexes = (on: boolean) => {
  const reflexes = bot.survival?.reflexes
  if (reflexes) reflexes.enabled = on
}

const inventorySummary = () => {
  const counts = new Map<string, number>()
  for (const item of bot.inventory.items()) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
  return [...counts].map(([name, count]) => `${count} ${name}`).join(', ') || 'nothing'
}

export const stopDriving = async (why: string) => {
  const was = survivalState.driving
  if (!was) return
  survivalState.driving = null
  updateHud()
  if (was === 'survival') {
    playAbort?.abort(new Error(why))
    bot.survival.tasks.cancelAll('ABORTED', why)
    setReflexes(false)
  }
  await bot.pathfinder.cancel()
  bot.clearControlStates()
  say(`stopped: ${why}`)
}

/**
 * A movement key the player pressed (controls.ts): while the bot drives, the press stops it instead of moving, and the
 * next press moves the player. Returns whether the press was taken.
 */
export const takePlayerMovementInput = (pressed: boolean) => {
  if (!survivalState.driving) return false
  if (pressed) void stopDriving('movement key pressed')
  return true
}

/** the mouse doesn't turn the bot while it drives (the bot looks where it digs and walks) */
export const isBotDriving = () => survivalState.driving !== null

const startSurvival = async (until?: MilestoneId) => {
  if (survivalState.driving) {
    say(`already running (${survivalState.driving}): /survival stop first`, 'red')
    return
  }
  survivalState.driving = 'survival'
  survivalState.milestone = null
  const abort = new AbortController()
  playAbort = abort
  setReflexes(survivalState.reflexes)
  say(`started${until ? ` until ${until}` : ''}; a movement key or /survival stop stops it`)
  updateHud()
  const onMilestone = (event: { id: MilestoneId, title: string, tick: number }) => {
    say(`milestone ${event.id} reached: ${event.title} (tick ${event.tick})`, 'green')
  }
  bot.on('survivalMilestone' as any, onMilestone)
  try {
    const result: PlayResult = await bot.survival.play({
      until,
      signal: abort.signal,
      saveStore: localStorageStore(saveKey()),
      log (line) {
        console.log('[survival]', line)
        const working = /^working on (\w+)/.exec(line)
        if (working) survivalState.milestone = working[1] as MilestoneId
        survivalState.lastLine = line
        say(line)
        updateHud()
      },
    })
    const error = result.error instanceof Error ? `: ${result.error.message}` : ''
    say(`play stopped (${result.reason}${result.stoppedAt ? ` at ${result.stoppedAt}` : ''})${error}; reached ${result.reached.map(r => r.id).join(', ') || 'nothing'}`, result.reason === 'until' || result.reason === 'finished' ? 'green' : 'yellow')
  } catch (err) {
    console.error(err)
    say(`play failed: ${(err as Error).message}`, 'red')
  } finally {
    bot.off('survivalMilestone' as any, onMilestone)
    // (a play started after this one was stopped is left running)
    if (playAbort === abort) {
      setReflexes(false)
      playAbort = null
      if (survivalState.driving === 'survival') survivalState.driving = null
      updateHud()
    }
  }
}

const gotoBlock = async (x: number, y: number, z: number) => {
  if (survivalState.driving) {
    say(`already running (${survivalState.driving}): stop it first`, 'red')
    return
  }
  survivalState.driving = 'goto'
  updateHud()
  say(`going to ${x} ${y} ${z}`)
  const started = Date.now()
  try {
    await bot.pathfinder.goto(new goals.GoalBlock(x, y, z))
    // (a goto cancelled ends as one that got there)
    if (survivalState.driving !== 'goto') return
    const at = bot.entity.position
    say(`at ${at.x.toFixed(1)} ${at.y.toFixed(1)} ${at.z.toFixed(1)} after ${((Date.now() - started) / 1000).toFixed(1)} s`, 'green')
  } catch (err) {
    if (survivalState.driving === 'goto') say(`goto failed: ${(err as Error).message}`, 'red')
  } finally {
    if (survivalState.driving === 'goto') survivalState.driving = null
    updateHud()
  }
}

const milestoneIds = MILESTONES.map(m => m.id)

export const survivalCommands = [
  {
    command: ['/survival'],
    alwaysAvailable: true,
    async invoke ([sub, ...args]: string[]) {
      switch (sub) {
        case 'start': {
          let until: MilestoneId | undefined
          if (args[0] === 'until') {
            if (!milestoneIds.includes(args[1] as MilestoneId)) {
              say(`until what? one of ${milestoneIds.join(', ')}`, 'red')
              return
            }
            until = args[1] as MilestoneId
          }
          await startSurvival(until)
          return
        }
        case 'stop':
          if (!survivalState.driving) say('not running')
          else await stopDriving('/survival stop')
          return
        case 'status': {
          const task = bot.survival.tasks.current
          const reflex = bot.survival.reflexes?.current
          say(`${survivalState.driving ?? 'idle'}; milestone ${survivalState.milestone ?? '-'}; task ${task?.name ?? '-'}${reflex ? `; reflex ${reflex.name}` : ''}; reflexes ${survivalState.reflexes ? 'on' : 'off'} with play`)
          say(`inventory: ${inventorySummary()}`)
          if (survivalState.lastLine) say(`last: ${survivalState.lastLine}`)
          return
        }
        case 'reflexes':
          if (args[0] !== 'on' && args[0] !== 'off') {
            say('/survival reflexes on|off', 'red')
            return
          }
          survivalState.reflexes = args[0] === 'on'
          if (survivalState.driving === 'survival') setReflexes(survivalState.reflexes)
          say(`reflexes ${args[0]} while survival runs`)
          return
        case 'dump': {
          // the last stuck report's diagnosis, and a report of the bot as it is now (bot.survival.diagnostics.dump()):
          // the diagnoses in chat, the reports' JSON in the console (tens of kB each, too long for chat)
          const diagnostics = bot.survival?.diagnostics
          if (!diagnostics) {
            say('no diagnostics on this bot', 'red')
            return
          }
          const last = diagnostics.lastReports(1)[0]
          const report = diagnostics.dump('/survival dump')
          if (last) {
            say(`last report (${last.kind}, tick ${last.tick}): ${last.diagnosis}`, 'yellow')
            console.log('[survival] last report:', last.diagnosis, last)
            console.log(JSON.stringify(last))
          } else {
            say('no stuck report yet')
          }
          say(`now: ${report.diagnosis}`)
          console.log('[survival] dump:', report.diagnosis, report)
          console.log(JSON.stringify(report))
          say("the reports' JSON is in the console")
          return
        }
        case 'reset':
          localStorage.removeItem(saveKey())
          say('forgot the save of this server and player (the memory and the milestones reached)')
          return
        default:
          say('/survival start [until <milestone>] | stop | status | dump | reflexes on|off | reset', 'yellow')
      }
    }
  },
  {
    command: ['/goto'],
    alwaysAvailable: true,
    async invoke (args: string[]) {
      if (args[0] === 'cancel') {
        if (survivalState.driving === 'goto') await stopDriving('/goto cancel')
        else say('no goto running')
        return
      }
      const [x, y, z] = args.map(Number)
      if (args.length !== 3 || ![x, y, z].every(Number.isFinite)) {
        say('/goto <x> <y> <z> | cancel', 'red')
        return
      }
      await gotoBlock(Math.floor(x), Math.floor(y), Math.floor(z))
    }
  },
]

/**
 * The inventory screen while the bot clicks in the player's menu, as a player has it open to: mineflayer opens and closes
 * it around a craft in the player's grid (bot.openInventoryScreen, inventoryScreenOpen / inventoryScreenClose events),
 * and while survival or /goto drives, any other click in the player's menu opens it too, closed once 20 ticks go by
 * without one and nothing is on the cursor. The screen shown is the web client's own (player_win:player); mineflayer
 * sends the close of menu 0, so the screen doesn't send it again (inventoryScreenFromBot.closing).
 */
export const inventoryScreenFromBot = { shown: false, closing: false }
const PLAYER_SCREEN = 'player_win:player'
const playerScreen = () => activeModalStack.find(m => m.reactType === PLAYER_SCREEN)

const showInventoryScreen = () => {
  if (activeModalStack.length > 0) return
  showModal({ reactType: PLAYER_SCREEN })
  inventoryScreenFromBot.shown = !!playerScreen()
}

const hideInventoryScreen = () => {
  if (!inventoryScreenFromBot.shown) return
  inventoryScreenFromBot.shown = false
  const modal = playerScreen()
  if (!modal) return
  // (the screen's unmount, a render later, takes the flag)
  inventoryScreenFromBot.closing = true
  setTimeout(() => { inventoryScreenFromBot.closing = false }, 1000)
  hideModal(modal, undefined, { force: true })
}

// the player closed the screen the bot had open (Esc): it sent the close of menu 0, and the bot's driving stops
subscribe(activeModalStack, () => {
  if (!inventoryScreenFromBot.shown || playerScreen()) return
  inventoryScreenFromBot.shown = false
  void stopDriving('inventory screen closed')
})

const inventoryScreenForClicks = (bot: Bot) => {
  const IDLE_TICKS = 20
  let idle = -1
  const click = bot.clickWindow
  bot.clickWindow = async (...args) => {
    if (survivalState.driving && !bot.currentWindow && !bot.inventoryScreenOpen && !activeModalStack.length) {
      bot.openInventoryScreen()
    }
    if (bot.inventoryScreenOpen) idle = 0
    return click.apply(bot, args)
  }
  bot.on('physicsTick', () => {
    if (idle < 0 || !bot.inventoryScreenOpen) return
    if (++idle < IDLE_TICKS || bot.inventory.selectedItem) return
    idle = -1
    bot.closeInventoryScreen()
  })
  bot.on('inventoryScreenOpen', showInventoryScreen)
  bot.on('inventoryScreenClose', () => {
    idle = -1
    hideInventoryScreen()
  })
}

/** the pathfinder and survival on the bot, idle: the reflexes off until /survival start */
export default (bot: Bot) => {
  survivalState.driving = null
  survivalState.milestone = null
  survivalState.lastLine = ''
  playAbort = null
  updateHud()
  // on the first spawn: the pathfinder's movements read bot.entity (made on the login packet) when they're built
  bot.once('spawn', () => {
    if (!bot.pathfinder) bot.loadPlugin(createPathfinder())
    bot.loadPlugin(createSurvival({ loadPathfinder: false, reflexes: { enabled: false } }))
  })
  inventoryScreenFromBot.shown = false
  inventoryScreenForClicks(bot)
  bot.once('end', () => {
    playAbort?.abort(new Error('disconnected'))
    survivalState.driving = null
    updateHud()
  })
}
