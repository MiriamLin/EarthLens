import { SAMPLE_RATE, synthesizeNote, type Instrument } from './instruments.ts'
export { INSTRUMENTS, type Instrument } from './instruments.ts'

const NOTE_SECONDS = 0.25
const NOTE_COUNT = 128
const SCALE = [0, 2, 4, 7, 9]

export const PENTATONIC_NOTES = Array.from({ length: 20 }, (_, index) => {
  const midi = 48 + Math.floor(index / 5) * 12 + SCALE[index % 5]
  return 440 * 2 ** ((midi - 69) / 12)
})

export function monthEnd(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

export function resampleValues(values: (number | null)[], dates?: string[]) {
  if (!values.length) throw new Error('No sound data is available.')
  const times = dates ? dates.map((date) => Date.parse(date)) : values.map((_, index) => index)
  if (times.length !== values.length || times.some((time, index) => !Number.isFinite(time) || (index > 0 && time <= times[index - 1]))) {
    throw new Error('Sound data must have matching dates in chronological order.')
  }
  const clean = values.map((value) => value !== null && Number.isFinite(value) ? value : null)
  if (clean.length === NOTE_COUNT) return clean
  if (clean.length === 1) return Array<number | null>(NOTE_COUNT).fill(clean[0])
  const first = times[0]
  const span = times[times.length - 1] - first
  if (clean.length > NOTE_COUNT) {
    const sums = Array<number>(NOTE_COUNT).fill(0)
    const counts = Array<number>(NOTE_COUNT).fill(0)
    clean.forEach((value, index) => {
      if (value === null) return
      const bin = Math.min(NOTE_COUNT - 1, Math.floor((times[index] - first) / span * NOTE_COUNT))
      sums[bin] += value
      counts[bin]++
    })
    return sums.map((sum, index) => counts[index] ? sum / counts[index] : null)
  }
  let left = 0
  return Array.from({ length: NOTE_COUNT }, (_, index) => {
    const time = first + index / (NOTE_COUNT - 1) * span
    while (left < times.length - 2 && times[left + 1] < time) left++
    const a = clean[left]
    const b = clean[left + 1]
    if (time === times[left]) return a
    if (time === times[left + 1]) return b
    if (a === null || b === null) return null
    return a + (b - a) * (time - times[left]) / (times[left + 1] - times[left])
  })
}

export function createPitchTrack(raw: (number | null)[], dates?: string[]) {
  const values = resampleValues(raw, dates)
  let minimum = Infinity
  let maximum = -Infinity
  for (const value of values) {
    if (value === null) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (!Number.isFinite(minimum)) throw new Error('No valid values are available to play.')
  const normalized = values.map((value) => value === null ? null : maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum))
  const frequencies = normalized.map((value) => value === null ? null : PENTATONIC_NOTES[Math.min(19, Math.floor(value * 20))])
  return { values, normalized, frequencies, minimum, maximum }
}

export function renderPitchTrack(frequencies: (number | null)[], instrument: Instrument = 'piano') {
  if (!frequencies.length) throw new Error('No sound data is available.')
  const duration = frequencies.length * NOTE_SECONDS
  const samples = new Float32Array(Math.round(duration * SAMPLE_RATE))
  const cache = new Map<number, Float32Array>()
  frequencies.forEach((frequency, index) => {
    if (frequency === null) return
    let tone = cache.get(frequency)
    if (!tone) {
      tone = synthesizeNote(frequency, instrument, Math.ceil(SAMPLE_RATE * NOTE_SECONDS))
      cache.set(frequency, tone)
    }
    const start = Math.round(index * SAMPLE_RATE * NOTE_SECONDS)
    const end = Math.round((index + 1) * SAMPLE_RATE * NOTE_SECONDS)
    samples.set(tone.subarray(0, end - start), start)
  })
  return { samples, sampleRate: SAMPLE_RATE, duration: samples.length / SAMPLE_RATE }
}

export function mixSoundTracks(tracks: ReturnType<typeof renderPitchTrack>[]) {
  if (!tracks.length) throw new Error('Add a card to a track first.')
  const sampleRate = tracks[0].sampleRate
  const length = Math.max(...tracks.map((track) => track.samples.length))
  const samples = new Float32Array(length)
  for (const track of tracks) {
    if (track.sampleRate !== sampleRate) throw new Error('Tracks must use the same sample rate.')
    for (let index = 0; index < track.samples.length; index++) samples[index] += track.samples[index]
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (peak > 0.035) {
    const gain = 0.035 / peak
    for (let index = 0; index < samples.length; index++) samples[index] *= gain
  }
  return { samples, sampleRate, duration: samples.length / sampleRate }
}

export function playSoundTrack(context: AudioContext, track: ReturnType<typeof renderPitchTrack>, onEnd: () => void) {
  const buffer = context.createBuffer(1, track.samples.length, track.sampleRate)
  buffer.copyToChannel(track.samples, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  let stopped = false
  source.onended = () => {
    source.disconnect()
    if (!stopped) onEnd()
  }
  const started = context.currentTime
  source.start()
  return {
    progress: () => Math.max(0, Math.min(1, (context.currentTime - started) / track.duration)),
    stop() {
      if (stopped) return
      stopped = true
      source.stop()
    },
  }
}

export type SoundPlayer = {
  progress: () => number
  stop: () => void
  setGain: (index: number, gain: number) => void
}

export function playSoundTracks(
  context: AudioContext,
  tracks: ReturnType<typeof renderPitchTrack>[],
  gains: number[],
  from: number,
  onEnd: () => void,
): SoundPlayer {
  if (!tracks.length) throw new Error('Add a card to a track first.')
  const duration = Math.max(...tracks.map((track) => track.duration))
  const sum = new Float32Array(Math.max(...tracks.map((track) => track.samples.length)))
  for (const track of tracks) track.samples.forEach((sample, index) => { sum[index] += sample })
  let peak = 0
  for (const sample of sum) peak = Math.max(peak, Math.abs(sample))
  const master = context.createGain()
  master.gain.value = peak > 0.035 ? 0.035 / peak : 1
  master.connect(context.destination)
  const offset = Math.max(0, Math.min(1, from)) * duration
  let stopped = false
  let remaining = tracks.length
  const voices = tracks.map((track, index) => {
    const buffer = context.createBuffer(1, track.samples.length, track.sampleRate)
    buffer.copyToChannel(track.samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = gains[index] ?? 1
    source.connect(gain).connect(master)
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      remaining--
      if (remaining === 0) {
        master.disconnect()
        if (!stopped) onEnd()
      }
    }
    return { source, gain, start: Math.min(offset, track.duration) }
  })
  const started = context.currentTime
  for (const voice of voices) voice.source.start(0, voice.start)
  return {
    progress: () => Math.max(0, Math.min(1, (offset + context.currentTime - started) / duration)),
    stop() {
      if (stopped) return
      stopped = true
      for (const voice of voices) voice.source.stop()
    },
    setGain(index, value) {
      voices[index]?.gain.gain.setTargetAtTime(value, context.currentTime, 0.02)
    },
  }
}
