// The arm swing and block-break animations for what the bot does through mineflayer's own API (bot.dig,
// bot.placeBlock, bot.attack, bot.swingArm: survival, the pathfinder, any script), as mineflayer-mouse emits them for the
// player's clicks: botArmSwingStart / botArmSwingEnd, startDigging, blockBreakProgressStage. A swing or a dig that
// mineflayer-mouse runs itself emits its own, so none is emitted twice.
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'

export default (bot: Bot) => {
  // a swing through bot.swingArm: mineflayer-mouse calls it too, and emits its events right after (LocalPlayer.swing)
  let pendingSwing: 'left' | 'right' | null = null
  bot.on('botArmSwingStart', () => {
    pendingSwing = null
  })
  const { swingArm } = bot
  bot.swingArm = (arm = 'right', showHand?: boolean) => {
    swingArm.call(bot, arm, showHand)
    // mineflayer's dig swings every tick: its dig animation is one long swing
    if (dig) return
    pendingSwing = arm
    queueMicrotask(() => {
      if (pendingSwing !== arm) return
      pendingSwing = null
      bot.emit('botArmSwingStart', arm)
      bot.emit('botArmSwingEnd', arm)
    })
  }

  // a dig through bot.dig (bot.targetDigBlock): the crack stage of its progress each tick, as the destroy progress
  // goes on (MultiPlayerGameMode.continueDestroyBlock: 10 stages)
  let dig: { block: Block, perTick: number, ticks: number, stage: number } | null = null
  const endDig = () => {
    if (!dig) return
    const { block } = dig
    dig = null
    bot.emit('blockBreakProgressStage', block, null)
    bot.emit('botArmSwingEnd', 'right')
  }
  bot.on('physicsTick', () => {
    const target = bot.targetDigBlock
    if (dig && (!target || !target.position.equals(dig.block.position))) endDig()
    if (!target) return
    if (!dig) {
      const time = bot.digTime(target)
      dig = { block: target, perTick: time <= 0 ? 1 : 50 / time, ticks: 0, stage: -1 }
      bot.emit('startDigging', target)
      bot.emit('botArmSwingStart', 'right')
    }
    dig.ticks++
    const stage = Math.min(9, Math.floor(dig.ticks * dig.perTick * 10))
    if (stage !== dig.stage) {
      dig.stage = stage
      bot.emit('blockBreakProgressStage', dig.block, stage)
    }
  })
  bot.on('diggingCompleted', endDig)
  bot.on('diggingAborted', endDig)
}
