import assert from 'node:assert/strict'
import test from 'node:test'
import { createPitchTrack, INSTRUMENTS, mixSoundTracks, monthEnd, PENTATONIC_NOTES, playSoundTrack, renderPitchTrack, resampleValues } from '../src/lib/sound.ts'

test('the twenty legal pitches are C D E G A in four octaves', () => {
  const midi = PENTATONIC_NOTES.map((frequency) => Math.round(69 + 12 * Math.log2(frequency / 440)))
  assert.deepEqual(midi, [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93])
})

test('increasing values use all twenty pitches in order and include the maximum safely', () => {
  const track = createPitchTrack(Array.from({ length: 128 }, (_, index) => index - 64))
  assert.equal(track.normalized[0], 0)
  assert.equal(track.normalized[127], 1)
  assert.equal(track.frequencies[0], PENTATONIC_NOTES[0])
  assert.equal(track.frequencies[127], PENTATONIC_NOTES[19])
  assert.deepEqual([...new Set(track.frequencies)], PENTATONIC_NOTES)
  assert.ok(track.frequencies.every((value, index) => index === 0 || value >= track.frequencies[index - 1]))
})

test('equal-width value bins quantize to the expected notes', () => {
  const values = Array(128).fill(0)
  for (let index = 0; index <= 20; index++) values[index] = index
  const track = createPitchTrack(values)
  for (let index = 0; index <= 20; index++) {
    assert.equal(track.frequencies[index], PENTATONIC_NOTES[Math.min(index, 19)])
  }
})

test('constant data stays at a single legal middle pitch', () => {
  const track = createPitchTrack([23, 23])
  assert.ok(track.normalized.every((value) => value === 0.5))
  assert.ok(track.frequencies.every((frequency) => frequency === PENTATONIC_NOTES[10]))
})

test('long series average all observations into 128 time bins', () => {
  const values = Array.from({ length: 256 }, (_, index) => index)
  assert.deepEqual(resampleValues(values), Array.from({ length: 128 }, (_, index) => index * 2 + 0.5))
  const track = createPitchTrack(values)
  assert.equal(track.minimum, 0.5)
  assert.equal(track.maximum, 254.5)
})

test('aggregation uses elapsed time rather than equal counts of irregular observations', () => {
  const epoch = Date.UTC(2020, 0, 1)
  const dates = Array.from({ length: 256 }, (_, index) => new Date(epoch + (index === 255 ? 1280000 : index * 1000)).toISOString())
  const values = resampleValues(Array.from({ length: 256 }, (_, index) => index), dates)
  assert.equal(values[0], 4.5)
  assert.equal(values[25], 252)
  assert.ok(values.slice(26, 127).every((value) => value === null))
  assert.equal(values[127], 255)
})

test('short series interpolate in time without bridging missing observations', () => {
  const values = resampleValues([0, 127])
  assert.equal(values.length, 128)
  assert.ok(values.every((value, index) => Math.abs(value - index) < 1e-12))
  const gap = resampleValues([1, null, 3])
  assert.equal(gap[0], 1)
  assert.equal(gap[127], 3)
  assert.ok(gap.slice(1, 127).every((value) => value === null))
  assert.deepEqual(resampleValues([7]), Array(128).fill(7))
  const dated = resampleValues([0, 10, 30], ['2020-01-01', '2020-01-02', '2020-01-04'])
  assert.ok(Math.abs(dated[64] - 30 * 64 / 127) < 1e-10)
})

test('missing and nonfinite values are rests and empty bins are not treated as zero', () => {
  const values = Array(128).fill(10)
  values[0] = null
  values[1] = NaN
  values[2] = Infinity
  const track = createPitchTrack(values)
  assert.deepEqual(track.frequencies.slice(0, 3), [null, null, null])
  const raw = Array(256).fill(10)
  raw[0] = null
  raw[1] = null
  raw[2] = null
  assert.deepEqual(resampleValues(raw).slice(0, 2), [null, 10])
  assert.throws(() => createPitchTrack([null, NaN]), /No valid values/)
  assert.throws(() => createPitchTrack([]), /No sound data/)
  assert.throws(() => createPitchTrack([1, 2], ['2020-01-02', '2020-01-01']), /chronological order/)
})

test('monthly date ranges include the correct final calendar day', () => {
  assert.equal(monthEnd('2024-02'), '2024-02-29')
  assert.equal(monthEnd('2025-02'), '2025-02-28')
  assert.equal(monthEnd('2024-12'), '2024-12-31')
})

test('every original time range produces 128 note slots at four notes per second', () => {
  for (const length of [1, 12, 128, 365, 16436, 100000]) {
    const melody = createPitchTrack(Array.from({ length }, (_, index) => index))
    assert.equal(melody.frequencies.length, 128)
    assert.equal(melody.values.length, 128)
    const track = renderPitchTrack(melody.frequencies)
    assert.equal(track.duration, 32)
    assert.equal(track.samples.length, 32 * track.sampleRate)
  }
})

test('instrument choices preserve timing, silence, and pitch while producing distinct audio', () => {
  const frequencies = Array(128).fill(PENTATONIC_NOTES[0])
  frequencies[64] = null
  frequencies[127] = PENTATONIC_NOTES[19]
  const tracks = Object.keys(INSTRUMENTS).map((instrument) => renderPitchTrack(frequencies, instrument))
  for (const track of tracks) {
    assert.equal(track.duration, 32)
    assert.ok(track.samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.035001))
    const noteLength = track.sampleRate / 4
    assert.ok(track.samples.slice(Math.ceil(64 * noteLength), Math.floor(65 * noteLength)).every((value) => value === 0))
    assert.ok(track.samples.slice(Math.ceil(127 * noteLength)).some((value) => value !== 0))
  }
  for (let index = 0; index < tracks.length; index++) {
    for (let other = index + 1; other < tracks.length; other++) {
      assert.ok(tracks[index].samples.some((value, sample) => value !== tracks[other].samples[sample]))
    }
  }
  const flute = tracks[2]
  let crossings = 0
  const start = Math.ceil(127.3 * flute.sampleRate / 4)
  const end = Math.floor(127.6 * flute.sampleRate / 4)
  for (let index = start + 1; index < end; index++) {
    if (flute.samples[index - 1] <= 0 && flute.samples[index] > 0) crossings++
  }
  assert.ok(Math.abs(crossings - 1760 * 0.25 * 0.3) <= 1)
})

function spectralMagnitude(track, frequency, start, end) {
  const first = Math.ceil(start * track.sampleRate)
  const last = Math.floor(end * track.sampleRate)
  let real = 0
  let imaginary = 0
  for (let index = first; index < last; index++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * (index - first) / (last - first - 1))
    const phase = 2 * Math.PI * frequency * index / track.sampleRate
    real += track.samples[index] * Math.cos(phase) * window
    imaginary += track.samples[index] * Math.sin(phase) * window
  }
  return Math.hypot(real, imaginary)
}

test('all six instruments retain the twenty intended pitches at bounded levels', () => {
  for (const instrument of Object.keys(INSTRUMENTS)) {
    for (const frequency of PENTATONIC_NOTES) {
      const track = renderPitchTrack([frequency], instrument)
      const rms = Math.sqrt(track.samples.reduce((sum, value) => sum + value ** 2, 0) / track.samples.length)
      assert.ok(rms >= 0.006 && rms <= 0.012001, `${instrument} has an unexpected level at ${frequency} Hz`)
      let bestMagnitude = -Infinity
      let bestOffset = 0
      for (let cents = -20; cents <= 20; cents++) {
        const magnitude = spectralMagnitude(track, frequency * 2 ** (cents / 1200), 0.025, 0.2)
        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude
          bestOffset = cents
        }
      }
      assert.ok(Math.abs(bestOffset) <= 3, `${instrument} at ${frequency} Hz drifted by ${bestOffset} cents`)
    }
  }
})

test('piano upper partials decay faster than the fundamental and note edges fade to silence', () => {
  const frequency = PENTATONIC_NOTES[5]
  const piano = renderPitchTrack([frequency], 'piano')
  const early = spectralMagnitude(piano, frequency * 4, 0.015, 0.075) / spectralMagnitude(piano, frequency, 0.015, 0.075)
  const late = spectralMagnitude(piano, frequency * 4, 0.16, 0.22) / spectralMagnitude(piano, frequency, 0.16, 0.22)
  assert.ok(late < early * 0.8)
  for (const instrument of Object.keys(INSTRUMENTS)) {
    const track = renderPitchTrack([frequency], instrument)
    assert.equal(Math.abs(track.samples[0]), 0)
    assert.equal(Math.abs(track.samples.at(-1)), 0)
    assert.deepEqual(track.samples, renderPitchTrack([frequency], instrument).samples)
  }
})

test('low clarinet emphasizes odd harmonics while flute has a stronger second harmonic', () => {
  const frequency = PENTATONIC_NOTES[5]
  const clarinet = renderPitchTrack([frequency], 'clarinet')
  const flute = renderPitchTrack([frequency], 'flute')
  assert.ok(spectralMagnitude(clarinet, frequency * 3, 0.03, 0.2) > spectralMagnitude(clarinet, frequency * 2, 0.03, 0.2) * 5)
  assert.ok(spectralMagnitude(flute, frequency * 2, 0.03, 0.2) > spectralMagnitude(flute, frequency * 3, 0.03, 0.2) * 3)
})

test('marimba has a tuned bar mode that fades faster than its fundamental', () => {
  const frequency = PENTATONIC_NOTES[5]
  const marimba = renderPitchTrack([frequency], 'marimba')
  const ratio = (start, end) => spectralMagnitude(marimba, frequency * 3.99, start, end) / spectralMagnitude(marimba, frequency, start, end)
  assert.ok(spectralMagnitude(marimba, frequency * 3.99, 0.03, 0.2) > spectralMagnitude(marimba, frequency * 2, 0.03, 0.2) * 30)
  assert.ok(ratio(0.16, 0.22) < ratio(0.015, 0.075) * 0.4)
})

test('sustained instruments hold energy and repeated notes meet without abrupt jumps', () => {
  const frequency = PENTATONIC_NOTES[5]
  function energy(track, start, end) {
    return track.samples.slice(Math.ceil(start * track.sampleRate), Math.floor(end * track.sampleRate)).reduce((sum, value) => sum + value ** 2, 0)
  }
  for (const instrument of ['flute', 'clarinet', 'cello']) {
    const track = renderPitchTrack([frequency], instrument)
    assert.ok(energy(track, 0.16, 0.2) > energy(track, 0.03, 0.07) * 0.65)
  }
  for (const instrument of Object.keys(INSTRUMENTS)) {
    const track = renderPitchTrack([frequency, frequency, null, frequency], instrument)
    for (let note = 1; note < 4; note++) {
      const boundary = Math.round(note * track.sampleRate / 4)
      assert.ok(Math.abs(track.samples[boundary] - track.samples[boundary - 1]) < 0.001)
    }
  }
})

test('mixing aligns tracks at sample zero, retains silence, and does not alter source audio', () => {
  const first = { samples: Float32Array.from([0.01, 0, 0, 0.01]), sampleRate: 4, duration: 1 }
  const second = { samples: Float32Array.from([0, 0.02]), sampleRate: 4, duration: 0.5 }
  const mixed = mixSoundTracks([first, second])
  assert.deepEqual(mixed.samples, Float32Array.from([0.01, 0.02, 0, 0.01]))
  assert.equal(mixed.duration, 1)
  assert.equal(mixed.sampleRate, 4)
  assert.deepEqual(first.samples, Float32Array.from([0.01, 0, 0, 0.01]))
  assert.deepEqual(second.samples, Float32Array.from([0, 0.02]))
  assert.throws(() => mixSoundTracks([]), /Add a card/)
  assert.throws(() => mixSoundTracks([first, { ...second, sampleRate: 8 }]), /sample rate/)
})

test('mixing many correlated tracks limits peaks without changing their relative dynamics', () => {
  const track = { samples: Float32Array.from([0, 0.035, -0.035, 0.0175, 0]), sampleRate: 5, duration: 1 }
  const mixed = mixSoundTracks(Array(100).fill(track))
  assert.ok(mixed.samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 0.035001))
  assert.ok(Math.abs(mixed.samples[3] / mixed.samples[1] - 0.5) < 1e-6)
  assert.equal(mixed.samples[0], 0)
  assert.equal(mixed.samples[4], 0)
})

function audioContext() {
  let source
  let copied
  let stops = 0
  let disconnected = 0
  let sources = 0
  const context = {
    currentTime: 5,
    destination: {},
    createBuffer(channels, length, sampleRate) {
      return { channels, length, sampleRate, copyToChannel(samples) { copied = samples } }
    },
    createBufferSource() {
      sources++
      source = {
        buffer: null, onended: null,
        connect() {}, start() {}, stop() { stops++ },
        disconnect() { disconnected++ },
      }
      return source
    },
  }
  return { context, source: () => source, copied: () => copied, stops: () => stops, disconnected: () => disconnected, sources: () => sources }
}

test('ensemble playback uses one clock and stops every mixed part together', () => {
  const audio = audioContext()
  const tracks = [renderPitchTrack(Array(128).fill(220), 'guitar'), renderPitchTrack(Array(128).fill(440), 'flute')]
  const mixed = mixSoundTracks(tracks)
  let ended = 0
  const player = playSoundTrack(audio.context, mixed, () => { ended++ })
  assert.equal(audio.sources(), 1)
  assert.equal(audio.copied(), mixed.samples)
  audio.context.currentTime = 21
  assert.equal(player.progress(), 0.5)
  player.stop()
  audio.source().onended()
  assert.equal(audio.stops(), 1)
  assert.equal(ended, 0)
})

test('playback uses rendered audio and reports progress from the audio clock', () => {
  const audio = audioContext()
  const track = renderPitchTrack(Array(128).fill(440))
  let ended = 0
  const player = playSoundTrack(audio.context, track, () => { ended++ })
  assert.equal(audio.copied(), track.samples)
  assert.equal(player.progress(), 0)
  audio.context.currentTime = 21
  assert.equal(player.progress(), 0.5)
  audio.context.currentTime = 37
  assert.equal(player.progress(), 1)
  audio.source().onended()
  assert.equal(ended, 1)
  assert.equal(audio.disconnected(), 1)
})

test('stopping is idempotent and does not invoke natural completion', () => {
  const audio = audioContext()
  let ended = 0
  const player = playSoundTrack(audio.context, renderPitchTrack(Array(128).fill(440)), () => { ended++ })
  player.stop()
  player.stop()
  audio.source().onended()
  assert.equal(audio.stops(), 1)
  assert.equal(audio.disconnected(), 1)
  assert.equal(ended, 0)
})
