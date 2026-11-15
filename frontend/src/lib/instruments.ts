export const SAMPLE_RATE = 22050

export const INSTRUMENTS = {
  piano: { label: 'Piano' },
  guitar: { label: 'Guitar' },
  flute: { label: 'Flute' },
  clarinet: { label: 'Clarinet' },
  cello: { label: 'Cello' },
  marimba: { label: 'Marimba' },
}

export type Instrument = keyof typeof INSTRUMENTS

function noiseSource(frequency: number) {
  let seed = Math.round(frequency * 1000) || 1
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 2147483648 - 1
  }
}

function finishTone(tone: Float64Array) {
  let previous = 0
  let filtered = 0
  let peak = 0
  let energy = 0
  for (let index = 0; index < tone.length; index++) {
    filtered = tone[index] - previous + 0.995 * filtered
    previous = tone[index]
    const fade = Math.max(0, Math.min(1, index / (SAMPLE_RATE * 0.002), (tone.length - 1 - index) / (SAMPLE_RATE * 0.012)))
    tone[index] = filtered * fade
    peak = Math.max(peak, Math.abs(tone[index]))
    energy += tone[index] ** 2
  }
  const rms = Math.sqrt(energy / tone.length)
  const gain = peak ? Math.min(0.035 / peak, 0.012 / rms) : 0
  return Float32Array.from(tone, (value) => value * gain)
}

function pianoTone(frequency: number, length: number) {
  const tone = new Float64Array(length)
  const stiffness = 0.00007 * (1 + frequency / 1000)
  for (let harmonic = 1; harmonic <= 18; harmonic++) {
    const partial = frequency * harmonic * Math.sqrt((1 + stiffness * harmonic ** 2) / (1 + stiffness))
    if (partial * 1.0008 >= SAMPLE_RATE / 2) break
    const weight = Math.exp(-harmonic * 0.14) * (0.4 + 0.6 * Math.abs(Math.sin(harmonic * Math.PI / 7))) / harmonic ** 1.15
    const fastDecay = Math.exp(-(0.8 + frequency / 2000 + harmonic * 0.65) / SAMPLE_RATE)
    const slowDecay = Math.exp(-(0.35 + harmonic * 0.18) / SAMPLE_RATE)
    for (const detune of [-0.0008, 0, 0.0008]) {
      const omega = 2 * Math.PI * partial * (1 + detune) / SAMPLE_RATE
      const coefficient = 2 * Math.cos(omega)
      let previous = -Math.sin(omega)
      let current = 0
      let fast = weight * 0.75 / 3
      let slow = weight * 0.25 / 3
      for (let index = 0; index < length; index++) {
        tone[index] += current * (fast + slow)
        const next = coefficient * current - previous
        previous = current
        current = next
        fast *= fastDecay
        slow *= slowDecay
      }
    }
  }
  const noise = noiseSource(frequency)
  let hammer = 0
  for (let index = 0; index < Math.min(length, SAMPLE_RATE * 0.025); index++) {
    hammer += 0.4 * (noise() - hammer)
    tone[index] += hammer * 0.08 * Math.exp(-index / SAMPLE_RATE * 350)
  }
  return finishTone(tone)
}

function guitarTone(frequency: number, length: number) {
  const omega = 2 * Math.PI * frequency / SAMPLE_RATE
  const damping = Math.min(0.5, 40 / frequency)
  const filterDelay = Math.atan2(damping * Math.sin(omega), 1 - damping + damping * Math.cos(omega)) / omega
  const delay = SAMPLE_RATE / frequency - filterDelay
  const integerDelay = Math.floor(delay)
  const fraction = delay - integerDelay
  const coefficient = Math.sin((1 - fraction) * omega / 2) / Math.sin((1 + fraction) * omega / 2)
  const feedback = Math.exp(-3 / (frequency * 0.9))
  const string = new Float64Array(integerDelay)
  const noise = noiseSource(frequency)
  let mean = 0
  for (let index = 0; index < string.length; index++) {
    const position = index / string.length
    const pluck = position < 0.22 ? position / 0.22 : (1 - position) / 0.78
    string[index] = (pluck * 2 - 1) * 0.8 + noise() * 0.2
    mean += string[index] / string.length
  }
  for (let index = 0; index < string.length; index++) string[index] -= mean
  const tone = new Float64Array(length)
  let head = 0
  let lastInput = 0
  let lastOutput = 0
  let previous = 0
  for (let index = 0; index < length; index++) {
    const input = string[head]
    const tuned = coefficient * input + lastInput - coefficient * lastOutput
    lastInput = input
    lastOutput = tuned
    const output = (1 - damping) * tuned + damping * previous
    previous = tuned
    string[head] = output * feedback
    head = (head + 1) % string.length
    tone[index] = output
  }
  return finishTone(tone)
}

function formant(frequency: number, center: number, width: number) {
  return Math.exp(-0.5 * (Math.log2(frequency / center) / width) ** 2)
}

function sustainedTone(frequency: number, length: number, instrument: 'flute' | 'clarinet' | 'cello') {
  const settings = {
    flute: { attack: 0.03, release: 0.03, vibrato: 4, rate: 5.2, noise: 0.025 },
    clarinet: { attack: 0.018, release: 0.025, vibrato: 1.5, rate: 4.8, noise: 0.008 },
    cello: { attack: 0.055, release: 0.035, vibrato: 5, rate: 5.5, noise: 0.016 },
  }[instrument]
  const register = Math.max(0, Math.min(1, Math.log2(frequency / 440) / 2))
  const harmonics = Math.min(32, Math.floor(SAMPLE_RATE * 0.46 / frequency))
  const weights = Array.from({ length: harmonics }, (_, index) => {
    const harmonic = index + 1
    const partial = frequency * harmonic
    if (instrument === 'flute') {
      return Math.exp(-(harmonic - 1) * (1.65 - register * 0.35)) / harmonic ** 0.3
    }
    if (instrument === 'clarinet') {
      const reed = harmonic % 2 ? 1 : 0.035 + register * 0.5
      return reed / harmonic ** 1.15 * Math.exp(-((partial / (2500 + frequency)) ** 2))
    }
    const body = 0.5 + 1.1 * formant(partial, 220, 0.35) + 0.9 * formant(partial, 450, 0.3)
      + 1.2 * formant(partial, 1000, 0.4) + 0.6 * formant(partial, 2200, 0.4)
    return body * Math.exp(-partial / 6500) / harmonic ** 1.15
  })
  const tone = new Float64Array(length)
  const noise = noiseSource(frequency)
  const vibrato = 2 ** (settings.vibrato / 1200) - 1
  let phase = 0
  let fastNoise = 0
  let slowNoise = 0
  for (let index = 0; index < length; index++) {
    const time = index / SAMPLE_RATE
    const attack = Math.sin(Math.min(1, time / settings.attack) * Math.PI / 2) ** 2
    const release = Math.sin(Math.min(1, (length - 1 - index) / (SAMPLE_RATE * settings.release)) * Math.PI / 2) ** 2
    const depth = Math.min(1, Math.max(0, (time - 0.05) / 0.1))
    const motion = Math.sin(2 * Math.PI * settings.rate * time)
    let sound = 0
    for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
      const development = harmonic === 1 ? 1 : 0.65 + 0.35 * attack
      sound += Math.sin(phase * harmonic) * weights[harmonic - 1] * development
    }
    const random = noise()
    fastNoise += 0.65 * (random - fastNoise)
    slowNoise += 0.08 * (random - slowNoise)
    const air = instrument === 'cello' ? slowNoise : fastNoise - slowNoise
    const breath = 1 + depth * motion * (instrument === 'flute' ? 0.035 : 0.015)
    tone[index] = (sound * breath + air * settings.noise) * attack * release
    phase += 2 * Math.PI * frequency / SAMPLE_RATE * (1 + depth * motion * vibrato)
  }
  return finishTone(tone)
}

function marimbaTone(frequency: number, length: number) {
  const tone = new Float64Array(length)
  const modes = [[1, 1, 4 + frequency / 700], [3.99, 0.22, 22], [10.65, 0.08, 55]]
  for (const [ratio, weight, decay] of modes) {
    const partial = frequency * ratio
    if (partial >= SAMPLE_RATE * 0.46) continue
    const omega = 2 * Math.PI * partial / SAMPLE_RATE
    const coefficient = 2 * Math.cos(omega)
    const loss = Math.exp(-decay / SAMPLE_RATE)
    let previous = -Math.sin(omega)
    let current = 0
    let amplitude = weight
    for (let index = 0; index < length; index++) {
      tone[index] += current * amplitude
      const next = coefficient * current - previous
      previous = current
      current = next
      amplitude *= loss
    }
  }
  const noise = noiseSource(frequency)
  let mallet = 0
  for (let index = 0; index < Math.min(length, SAMPLE_RATE * 0.02); index++) {
    mallet += 0.2 * (noise() - mallet)
    tone[index] += mallet * 0.06 * Math.exp(-index / SAMPLE_RATE * 400)
  }
  return finishTone(tone)
}

export function synthesizeNote(frequency: number, instrument: Instrument, length: number) {
  if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= SAMPLE_RATE / 2) {
    throw new Error('The requested pitch is outside the supported range.')
  }
  switch (instrument) {
    case 'piano': return pianoTone(frequency, length)
    case 'guitar': return guitarTone(frequency, length)
    case 'flute':
    case 'clarinet':
    case 'cello': return sustainedTone(frequency, length, instrument)
    case 'marimba': return marimbaTone(frequency, length)
  }
}
