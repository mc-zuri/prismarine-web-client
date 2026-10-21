// The respawn of a bot that died while survival drives it: the web client leaves the death screen up for the player
// (options.autoRespawn off, so mineflayer's own respawn is off too), and a bot whose play was running stayed dead on it,
// its runner waiting for the respawn to go on with its recovery (a refuge, the basics made again, back to work).
import type { Bot } from 'mineflayer'

/** the wait on the death screen before the respawn, as a player reads it and presses the button */
export const RESPAWN_DELAY_MS = 1000

/**
 * Respawns the bot RESPAWN_DELAY_MS after its health goes to 0 while `driving()` says survival drives it (checked
 * again when the wait ends: a play stopped meanwhile leaves the death screen to the player). One respawn per death.
 * Returns the listener's removal.
 */
export const respawnWhileDriving = (bot: Pick<Bot, 'on' | 'off' | 'health' | 'respawn'>, driving: () => boolean, delayMs = RESPAWN_DELAY_MS) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const onHealth = () => {
    if (bot.health > 0 || timer || !driving()) return
    timer = setTimeout(() => {
      timer = null
      if (bot.health > 0 || !driving()) return
      bot.respawn()
    }, delayMs)
  }
  const onRespawn = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  bot.on('health', onHealth)
  bot.on('respawn', onRespawn)
  return () => {
    onRespawn()
    bot.off('health', onHealth)
    bot.off('respawn', onRespawn)
  }
}
