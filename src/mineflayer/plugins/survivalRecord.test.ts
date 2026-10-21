import { describe, expect, it } from 'vitest'
import { AUTO_RECORD_BYTES, RECORD_BYTES, RECORD_USAGE, autoRecording, describeRecording, formatBytes, parseRecordCommand, recordingFileName } from './survivalRecord'

describe('/survival record', () => {
  it('parses start [MB], stop, save and status', () => {
    expect(parseRecordCommand(['start'])).toEqual({ action: 'start', maxBytes: RECORD_BYTES })
    expect(parseRecordCommand(['start', '16'])).toEqual({ action: 'start', maxBytes: 16 * 1024 * 1024 })
    expect(parseRecordCommand(['start', '0.5'])).toEqual({ action: 'start', maxBytes: 512 * 1024 })
    expect(parseRecordCommand(['start', 'lots'])).toEqual({ error: 'start takes the MB to keep, not lots' })
    expect(parseRecordCommand(['start', '-1'])).toHaveProperty('error')
    expect(parseRecordCommand(['stop'])).toEqual({ action: 'stop' })
    expect(parseRecordCommand(['save'])).toEqual({ action: 'save' })
    expect(parseRecordCommand(['status'])).toEqual({ action: 'status' })
    expect(parseRecordCommand([])).toEqual({ error: RECORD_USAGE })
    expect(parseRecordCommand(['pause'])).toEqual({ error: RECORD_USAGE })
  })

  it('names the download after the server, the player and the time', () => {
    const date = new Date('2026-10-21T19:31:18.123Z')
    expect(recordingFileName('mc.example.com:25565', 'Steve', date)).toBe('survival-mc.example.com_25565-Steve-2026-10-21T19-31-18.rec')
    expect(recordingFileName(undefined, 'a b/c', date)).toBe('survival-local-a_b_c-2026-10-21T19-31-18.rec')
    expect(recordingFileName('???', '', date)).toBe('survival-unknown-unknown-2026-10-21T19-31-18.rec')
  })

  it('tells the recording\'s size, ticks and the blocks dropped for room', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 kB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(describeRecording(null)).toMatch(/^no recording/)
    expect(describeRecording({ recording: true, stats: { bytes: 2048, rawBytes: 20_480, ticks: 1200 } })).toBe('recording: 2.0 kB kept (20.0 kB raw), 1200 ticks')
    expect(describeRecording({ recording: false, stats: { bytes: 2048, rawBytes: 20_480, ticks: 1200 }, dropped: 3 })).toBe('stopped: 2.0 kB kept (20.0 kB raw), 1200 ticks, the oldest 3 blocks dropped for room')
  })

  it('/survival start records by itself only when nothing records', () => {
    expect(autoRecording(null)).toEqual({ maxBytes: AUTO_RECORD_BYTES })
    expect(autoRecording({ recording: false })).toEqual({ maxBytes: AUTO_RECORD_BYTES })
    expect(autoRecording({ recording: true })).toBeNull()
  })
})
