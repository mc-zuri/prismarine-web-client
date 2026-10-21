import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { respawnWhileDriving, RESPAWN_DELAY_MS } from './survivalRespawn'

const fakeBot = () => {
  const bot = new EventEmitter() as EventEmitter & { health: number, respawn: ReturnType<typeof vi.fn> }
  bot.health = 20
  bot.respawn = vi.fn()
  bot.respawn.mockImplementation(() => {
    bot.health = 20
    bot.emit('respawn')
  })
  return bot
}

describe('respawnWhileDriving', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('respawns a bot that died while survival drives it, once, after the delay', () => {
    const bot = fakeBot()
    respawnWhileDriving(bot as any, () => true)
    bot.health = 0
    bot.emit('health')
    bot.emit('health')
    vi.advanceTimersByTime(RESPAWN_DELAY_MS - 1)
    expect(bot.respawn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(bot.respawn).toHaveBeenCalledTimes(1)
    // the next death respawns again
    bot.health = 0
    bot.emit('health')
    vi.advanceTimersByTime(RESPAWN_DELAY_MS)
    expect(bot.respawn).toHaveBeenCalledTimes(2)
  })

  it('leaves the death screen to the player when nothing drives the bot, or play stopped during the wait', () => {
    const bot = fakeBot()
    let driving = false
    respawnWhileDriving(bot as any, () => driving)
    bot.health = 0
    bot.emit('health')
    vi.advanceTimersByTime(RESPAWN_DELAY_MS * 2)
    expect(bot.respawn).not.toHaveBeenCalled()
    driving = true
    bot.emit('health')
    driving = false
    vi.advanceTimersByTime(RESPAWN_DELAY_MS)
    expect(bot.respawn).not.toHaveBeenCalled()
  })

  it('does nothing once the player respawned during the wait, or after its removal', () => {
    const bot = fakeBot()
    const remove = respawnWhileDriving(bot as any, () => true)
    bot.health = 0
    bot.emit('health')
    bot.health = 20
    bot.emit('respawn')
    vi.advanceTimersByTime(RESPAWN_DELAY_MS)
    expect(bot.respawn).not.toHaveBeenCalled()
    remove()
    bot.health = 0
    bot.emit('health')
    vi.advanceTimersByTime(RESPAWN_DELAY_MS)
    expect(bot.respawn).not.toHaveBeenCalled()
  })
})
