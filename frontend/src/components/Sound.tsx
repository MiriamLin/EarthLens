import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { DataOption, TimeSeriesData, TimeSeriesResult } from '../data'
import { fetchSeries, requestPeriod, type Temporal } from '../lib/series'
import DataDropZone from './DataDropZone'
import { createPitchTrack, INSTRUMENTS, playSoundTracks, renderPitchTrack, type Instrument, type SoundPlayer } from '../lib/sound'
import InstrumentIcon from './InstrumentIcon'
import LocationField, { DEFAULT_LOCATION, isValidLocation } from './LocationField'
import PeriodFields from './PeriodFields'
import DataWaveform from './DataWaveform'
import SoundTracks, { SOUND_CARD_TYPE } from './SoundTracks'
import { formatPeriod, formatTemporal } from '../lib/format'
import { readStored, usePersistentState, writeStored } from '../lib/persist'
import Alert from './Alert'
import { GripIcon, MusicIcon, PlayIcon, StopIcon, TrashIcon, SpinnerIcon } from './Icons'

type Card = {
  id: number
  instrument: Instrument
  values: (number | null)[]
  result: TimeSeriesResult
  series: TimeSeriesData
  track: ReturnType<typeof renderPitchTrack>
}

type Slot = 'card' | 'tracks'

const CARDS_KEY = 'earthlens.sound.cards'

function restoreCards(): Card[] {
  return readStored<Omit<Card, 'track'>[]>(CARDS_KEY, []).flatMap((card) => {
    try {
      if (!(card.instrument in INSTRUMENTS)) return []
      const melody = createPitchTrack(card.series.values, card.series.dates)
      return [{ ...card, values: melody.values, track: renderPitchTrack(melody.frequencies, card.instrument) }]
    } catch {
      return []
    }
  })
}
type Playback = { cardIds: number[]; player: SoundPlayer }

export default function Sound({ items, active }: { items: DataOption[]; active: boolean }) {
  const [key, setKey] = usePersistentState('earthlens.sound.key', '')
  const [latitude, setLatitude] = usePersistentState('earthlens.sound.latitude', DEFAULT_LOCATION.latitude)
  const [longitude, setLongitude] = usePersistentState('earthlens.sound.longitude', DEFAULT_LOCATION.longitude)
  const [temporal, setTemporal] = usePersistentState<Temporal>('earthlens.sound.temporal', 'daily', (value) => value === 'daily' || value === 'monthly')
  const [instrument, setInstrument] = usePersistentState<Instrument>('earthlens.sound.instrument', 'piano', (value) => typeof value === 'string' && value in INSTRUMENTS)
  const [start, setStart] = usePersistentState('earthlens.sound.start', `${new Date().getFullYear() - 1}-01-01`)
  const [end, setEnd] = usePersistentState('earthlens.sound.end', `${new Date().getFullYear() - 1}-12-31`)
  const [cards, setCards] = useState<Card[]>(restoreCards)
  const [loading, setLoading] = useState(false)
  const [tracks, setTracks] = usePersistentState<(number | null)[]>('earthlens.sound.tracks', [null])
  const [volumes, setVolumes] = usePersistentState<Record<number, number>>('earthlens.sound.volumes', {})
  const [playback, setPlayback] = useState<Record<Slot, Playback | null>>({ card: null, tracks: null })
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const players = useRef<Record<Slot, SoundPlayer | null>>({ card: null, tracks: null })
  const versions = useRef<Record<Slot, number>>({ card: 0, tracks: 0 })
  const cardId = useRef(cards.reduce((largest, card) => Math.max(largest, card.id), 0))

  useEffect(() => {
    writeStored(CARDS_KEY, cards.map(({ track, ...card }) => ({ ...card, result: { ...card.result, series: [] } })))
  }, [cards])

  const stop = useCallback((slot: Slot) => {
    versions.current[slot]++
    players.current[slot]?.stop()
    players.current[slot] = null
    setPlayback((current) => current[slot] ? { ...current, [slot]: null } : current)
  }, [])

  useEffect(() => {
    if (!active) {
      stop('card')
      stop('tracks')
      request.current?.abort()
      setLoading(false)
    }
  }, [active, stop])

  useEffect(() => () => {
    for (const slot of ['card', 'tracks'] as const) {
      versions.current[slot]++
      players.current[slot]?.stop()
    }
    request.current?.abort()
    void audio.current?.close().catch(() => {})
    audio.current = null
  }, [])

  function cancel() {
    request.current?.abort()
    setLoading(false)
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await fetchSeries(key, {
        latitude: Number(latitude),
        longitude: Number(longitude),
        ...requestPeriod(temporal, start, end),
      }, controller.signal)
      if (result.temporal !== temporal.toUpperCase()) throw new Error('The data service returned a different time resolution.')
      const series = result.series[0]
      if (!series) throw new Error('No data is available.')
      const melody = createPitchTrack(series.values, series.dates)
      const track = renderPitchTrack(melody.frequencies, instrument)
      if (!controller.signal.aborted) {
        const newCard = { id: ++cardId.current, instrument, result, series, track, values: melody.values }
        setCards((current) => [...current, newCard])
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to create a sound card.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function play(slot: Slot, selected: Card[], from = 0) {
    stop(slot)
    const version = versions.current[slot]
    setError('')
    if (!selected.length) return
    try {
      const context = audio.current ?? new AudioContext()
      audio.current = context
      await context.resume()
      if (version !== versions.current[slot]) return
      const gains = selected.map((card) => slot === 'tracks' ? volumes[card.id] ?? 1 : 1)
      const player = playSoundTracks(context, selected.map((card) => card.track), gains, from, () => {
        if (version !== versions.current[slot]) return
        players.current[slot] = null
        setPlayback((current) => ({ ...current, [slot]: null }))
      })
      players.current[slot] = player
      setPlayback((current) => ({ ...current, [slot]: { cardIds: selected.map((card) => card.id), player } }))
    } catch {
      if (version === versions.current[slot]) {
        stop(slot)
        setError('Audio playback is unavailable. Check your browser audio settings.')
      }
    }
  }

  function playTracks(from = 0) {
    void play('tracks', tracks.flatMap((id) => cards.filter((card) => card.id === id)), from)
  }

  function assignTrack(index: number, id: number) {
    stop('tracks')
    setTracks((current) => {
      const next = current.map((value, row) => row === index ? id : value === id ? null : value)
      return [...next.filter((value) => value !== null), null]
    })
  }

  function removeTrack(index: number) {
    stop('tracks')
    setTracks((current) => [...current.filter((value, row) => row !== index && value !== null), null])
  }

  function removeCard(id: number) {
    if (playback.card?.cardIds.includes(id)) stop('card')
    if (playback.tracks?.cardIds.includes(id)) stop('tracks')
    setCards((current) => current.filter((card) => card.id !== id))
    setTracks((current) => [...current.filter((value) => value !== null && value !== id), null])
  }

  function changeVolume(id: number, volume: number) {
    setVolumes((current) => ({ ...current, [id]: volume }))
    const index = playback.tracks?.cardIds.indexOf(id) ?? -1
    if (index >= 0) players.current.tracks?.setGain(index, volume)
  }

  return (
    <section aria-label="Sound workspace" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-5 pt-4 pb-5">
      <form data-tour="snd-form" onSubmit={generate} className="card flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto px-5 pt-4 pb-5">
        <h2 className="text-base font-semibold text-ink">New sound card</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="field-label">Data</span>
            <DataDropZone items={items} value={key} onChange={setKey} label="Sound data" />
          </label>
          <LocationField latitude={latitude} longitude={longitude} onChange={(lat, lon) => { setLatitude(lat); setLongitude(lon) }} />
          <PeriodFields
            temporal={temporal}
            start={start}
            end={end}
            onTemporalChange={setTemporal}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Instrument</span>
            <select value={instrument} onChange={(event) => setInstrument(event.target.value as Instrument)} className="field pr-8">
              {Object.entries(INSTRUMENTS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
            </select>
          </label>
          {loading ? (
            <button type="button" onClick={cancel} className="btn btn-secondary"><SpinnerIcon size={15} />Cancel</button>
          ) : (
            <button type="submit" disabled={!key || !isValidLocation(latitude, longitude)} className="btn btn-primary">Create card</button>
          )}
        </div>
      </form>
      {error && <Alert className="shrink-0">{error}</Alert>}
      <section data-tour="snd-cards" aria-label="Sound cards" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <h2 className="eyebrow shrink-0">Cards <span className="tabular-nums">{cards.length}</span></h2>
        {cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-navy-line bg-white/60 px-6 py-8 text-center">
            <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-navy-soft text-navy"><MusicIcon size={18} /></span>
            <p className="text-sm text-muted">No cards yet</p>
          </div>
        )}
        {cards.map((card) => {
          const playing = playback.card?.cardIds.includes(card.id) ?? false
          return (
            <article
              key={card.id}
              aria-label={`${card.series.name} sound card`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(SOUND_CARD_TYPE, String(card.id))
                event.dataTransfer.effectAllowed = 'copy'
              }}
              className={`group flex shrink-0 cursor-grab items-center gap-3 rounded-xl border bg-white px-3 py-2.5 transition-colors active:cursor-grabbing ${playing ? 'border-navy ring-3 ring-navy/10' : 'border-line hover:border-navy-line'}`}
            >
              <GripIcon className="shrink-0 text-subtle group-hover:text-navy" />
              <span title={INSTRUMENTS[card.instrument].label} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-navy">
                <InstrumentIcon instrument={card.instrument} className="h-5 w-5" />
              </span>
              <div className="w-56 min-w-0 shrink-0">
                <h3 className="truncate text-sm font-semibold text-ink" title={card.series.name}>{card.series.name}</h3>
                <p className="truncate text-xs text-muted">
                  {INSTRUMENTS[card.instrument].label} · {formatPeriod(card.result.start, card.result.end, card.result.temporal)} · {formatTemporal(card.result.temporal)}
                </p>
              </div>
              <div className="min-w-24 flex-1">
                <DataWaveform
                  values={card.values}
                  playback={playback.card?.cardIds.includes(card.id) ? playback.card.player : null}
                  onSeek={(position) => void play('card', [card], position)}
                  className="h-11 w-full"
                />
              </div>
              <button
                type="button"
                aria-label={playing ? 'Stop sound' : 'Play sound'}
                title={playing ? 'Stop' : 'Play'}
                onClick={() => playing ? stop('card') : void play('card', [card])}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-navy text-white transition-colors hover:bg-navy-strong"
              >
                {playing ? <StopIcon size={14} /> : <PlayIcon size={14} />}
              </button>
              <button
                type="button"
                aria-label={`Delete ${card.series.name} card`}
                title="Delete"
                onClick={() => removeCard(card.id)}
                className="icon-btn icon-btn-danger"
              >
                <TrashIcon />
              </button>
            </article>
          )
        })}
      </section>
      <SoundTracks
        cards={cards}
        tracks={tracks}
        volumes={volumes}
        playback={playback.tracks}
        playing={playback.tracks !== null}
        disabled={loading}
        onAssign={assignTrack}
        onRemove={removeTrack}
        onVolume={changeVolume}
        onPlay={playTracks}
        onStop={() => stop('tracks')}
      />
    </section>
  )
}
