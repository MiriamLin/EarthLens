import { useState } from 'react'
import { INSTRUMENTS, type Instrument, type SoundPlayer } from '../lib/sound'
import { PlayIcon, StopIcon, VolumeIcon } from './Icons'
import DataWaveform from './DataWaveform'
import InstrumentIcon from './InstrumentIcon'

export const SOUND_CARD_TYPE = 'application/x-earthlens-sound-card'

type TrackCard = {
  id: number
  instrument: Instrument
  series: { name: string }
  values: (number | null)[]
}

type Props = {
  cards: TrackCard[]
  tracks: (number | null)[]
  volumes: Record<number, number>
  playback: { cardIds: number[]; player: SoundPlayer } | null
  playing: boolean
  disabled: boolean
  onAssign: (index: number, cardId: number) => void
  onRemove: (index: number) => void
  onVolume: (cardId: number, volume: number) => void
  onPlay: (from?: number) => void
  onStop: () => void
}

export default function SoundTracks({ cards, tracks, volumes, playback, playing, disabled, onAssign, onRemove, onVolume, onPlay, onStop }: Props) {
  const [over, setOver] = useState<number | null>(null)
  const ready = tracks.some((id) => id !== null)

  return (
    <section data-tour="snd-tracks" aria-label="Music tracks" className="card flex max-h-[42%] min-h-0 shrink-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-ink">Tracks</h2>
        <button type="button" disabled={disabled || !ready} onClick={playing ? onStop : () => onPlay()} className={`btn btn-sm ml-auto ${playing ? 'btn-secondary' : 'btn-primary'}`}>
          {playing ? <StopIcon size={12} /> : <PlayIcon size={12} />}
          {playing ? 'Stop all' : 'Play all'}
        </button>
      </div>
      <div aria-label="Track list" className="min-h-0 space-y-2 overflow-y-auto px-5 py-3">
        {tracks.map((cardId, index) => {
          const card = cards.find((card) => card.id === cardId)
          const volume = card ? volumes[card.id] ?? 1 : 1
          return (
            <div
              key={index}
              aria-label={`Track ${index + 1}`}
              data-over={over === index}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(SOUND_CARD_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setOver(index)
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault()
                setOver(null)
                const id = Number(event.dataTransfer.getData(SOUND_CARD_TYPE))
                if (cards.some((card) => card.id === id)) onAssign(index, id)
              }}
              className={`flex min-h-16 flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${card
                ? `bg-white ${over === index ? 'border-navy ring-3 ring-navy/15' : 'border-line'}`
                : `border-dashed ${over === index ? 'border-navy bg-navy-soft' : 'border-navy-line bg-navy-soft/40'}`}`}
            >
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-subtle tabular-nums">{index + 1}</span>
              {card ? (
                <>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-navy">
                    <InstrumentIcon instrument={card.instrument} className="h-4 w-4" />
                  </span>
                  <div className="w-44 min-w-0 shrink-0">
                    <p className="truncate text-sm font-medium text-ink" title={card.series.name}>{card.series.name}</p>
                    <p className="text-xs text-muted">{INSTRUMENTS[card.instrument].label}</p>
                  </div>
                  <div className="min-w-32 flex-1">
                    <DataWaveform
                      values={card.values}
                      playback={playback?.cardIds.includes(card.id) ? playback.player : null}
                      onSeek={disabled ? undefined : (position) => onPlay(position)}
                      className="h-10 w-full"
                    />
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted" title="Track volume">
                    <VolumeIcon level={volume} className="text-subtle" />
                    <span className="sr-only">Volume for track {index + 1}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(volume * 100)}
                      onChange={(event) => onVolume(card.id, Number(event.target.value) / 100)}
                      className="w-24 cursor-pointer accent-navy"
                    />
                    <span className="w-9 text-right tabular-nums">{Math.round(volume * 100)}%</span>
                  </label>
                  <button type="button" aria-label={`Remove track ${index + 1}`} title="Remove from track" onClick={() => onRemove(index)} className="icon-btn icon-btn-danger">
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted">{over === index ? 'Release' : 'Drop a card'}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
