// The survival bot's recording in the browser (mineflayer-survival's recorder, bot.survival.recorder, kept in memory:
// the packets with the chunks and light as a summary, the tasks, reflexes, milestones, plans and log lines, the deaths,
// the bot's state every second; one compressed binary file, read with mineflayer-survival's `node tools/rec.cjs`).
// /survival record start [MB] | stop | save | status: save downloads what's kept as a .rec file. /survival start turns
// one on by itself when none runs, a ring of the last AUTO_RECORD_BYTES (the oldest blocks dropped), so a run that went
// wrong can be saved after; it goes on after /survival stop, till /survival record stop or the disconnect.

/** the ring /survival start records into when no recording runs */
export const AUTO_RECORD_BYTES = 32 * 1024 * 1024
/** the ring of /survival record start without a size */
export const RECORD_BYTES = 256 * 1024 * 1024

export type RecordCommand =
  | { action: 'start', maxBytes: number }
  | { action: 'stop' | 'save' | 'status' }
  | { error: string }

export const RECORD_USAGE = '/survival record start [MB] | stop | save | status'

/** /survival record's arguments */
export const parseRecordCommand = (args: readonly string[]): RecordCommand => {
  const [action, size] = args
  switch (action) {
    case 'start': {
      if (size === undefined) return { action, maxBytes: RECORD_BYTES }
      const mb = Number(size)
      if (!Number.isFinite(mb) || mb <= 0) return { error: `start takes the MB to keep, not ${size}` }
      return { action, maxBytes: Math.round(mb * 1024 * 1024) }
    }
    case 'stop':
    case 'save':
    case 'status':
      return { action }
    default:
      return { error: RECORD_USAGE }
  }
}

const safe = (s: string) => s.replaceAll(/[^\w.-]+/g, '_').replaceAll(/^_+|_+$/g, '') || 'unknown'

/** the download's name: survival-<server>-<player>-<UTC time>.rec */
export const recordingFileName = (server: string | undefined, username: string, date: Date) => {
  const stamp = date.toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  return `survival-${safe(server ?? 'local')}-${safe(username)}-${stamp}.rec`
}

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export interface RecordingFacts {
  recording: boolean
  stats: { bytes: number, rawBytes: number, ticks: number }
  /** the memory sink's blocks dropped for room */
  dropped?: number
}

/** a line on the recording for chat */
export const describeRecording = (rec: RecordingFacts | null | undefined) => {
  if (!rec) return 'no recording (/survival record start, or /survival start)'
  const { bytes, rawBytes, ticks } = rec.stats
  return `${rec.recording ? 'recording' : 'stopped'}: ${formatBytes(bytes)} kept (${formatBytes(rawBytes)} raw), ${ticks} ticks${rec.dropped ? `, the oldest ${rec.dropped} blocks dropped for room` : ''}`
}

/**
 * The recording /survival start wants: none when one runs already (the player's own, or the last start's), else the
 * ring of AUTO_RECORD_BYTES
 */
export const autoRecording = (current: { recording: boolean } | null | undefined) => (current?.recording ? null : { maxBytes: AUTO_RECORD_BYTES })
