import { useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { DataMetadata, OperatorInfo } from '../data'
import { blockCategory, type BlockCategory } from '../lib/formula'

type Suggestion = {
  name: string
  insert: string
  detail: string
  category: BlockCategory
  call: boolean
}

type Props = {
  id: string
  form: string
  value: string
  data: DataMetadata[]
  operators: OperatorInfo[]
  onChange: (value: string) => void
  onDragOver: (event: DragEvent<HTMLTextAreaElement>) => void
  onDrop: (event: DragEvent<HTMLTextAreaElement>) => void
}

const MAX_SUGGESTIONS = 50
const MIRRORED_STYLES = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'tabSize', 'textTransform', 'wordSpacing',
] as const

function wordAt(text: string, caret: number) {
  const before = text.slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? ''
  const after = text.slice(caret).match(/^[A-Za-z0-9_]*/)?.[0] ?? ''
  return { prefix: before, start: caret - before.length, end: caret + after.length }
}

function caretPoint(textarea: HTMLTextAreaElement, caret: number) {
  const mirror = document.createElement('div')
  const style = window.getComputedStyle(textarea)
  for (const property of MIRRORED_STYLES) mirror.style[property] = style[property]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.textContent = textarea.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const point = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop + parseFloat(style.lineHeight || '20'),
  }
  mirror.remove()
  return point
}

export default function FormulaInput({ id, form, value, data, operators, onChange, onDragOver, onDrop }: Props) {
  const listId = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [point, setPoint] = useState({ left: 0, top: 0 })

  const catalog = useMemo<Suggestion[]>(() => [
    ...operators
      .filter((item) => /^[A-Za-z_]\w*$/.test(item.name))
      .map((item) => ({
        name: item.name,
        insert: item.name,
        detail: item.signature,
        category: blockCategory(item.name, item.result_type),
        call: true,
      })),
    ...data.map((item) => ({ name: item.key, insert: item.key, detail: item.name, category: 'data' as const, call: false })),
  ], [data, operators])

  const word = wordAt(value, caret)
  const suggestions = useMemo(() => {
    if (!word.prefix) return []
    const prefix = word.prefix.toLowerCase()
    return catalog
      .filter((item) => item.name.toLowerCase().startsWith(prefix))
      .sort((a, b) => Number(!a.name.startsWith(word.prefix)) - Number(!b.name.startsWith(word.prefix))
        || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS)
  }, [catalog, word.prefix])
  const visible = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].name === word.prefix)

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textarea.current) return
    textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    setCaret(pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  useLayoutEffect(() => {
    if (!visible || !textarea.current) return
    const box = textarea.current
    const spot = caretPoint(box, word.start)
    setPoint({ left: Math.max(0, Math.min(spot.left, box.clientWidth - 288)), top: Math.min(spot.top, box.clientHeight) + 4 })
  }, [visible, word.start, value])

  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, visible])

  function syncCaret() {
    if (textarea.current) setCaret(textarea.current.selectionStart)
  }

  function accept(item: Suggestion) {
    const after = value.slice(word.end)
    const call = item.call && !after.startsWith('(')
    const text = call ? `${item.insert}()` : item.insert
    pendingCaret.current = word.start + item.insert.length + (call ? 1 : 0)
    setOpen(false)
    onChange(value.slice(0, word.start) + text + after)
  }

  return (
    <div data-tour="ts-text" className="relative shrink-0">
      <textarea
        ref={textarea}
        id={id}
        form={form}
        aria-label="Formula"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible ? `${listId}-${active}` : undefined}
        required
        maxLength={2000}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setCaret(event.target.selectionStart)
          setActive(0)
          setOpen(true)
          onChange(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === ' ' && event.ctrlKey) {
            event.preventDefault()
            syncCaret()
            setOpen(true)
            return
          }
          if (!visible) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((current) => (current + step + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            accept(suggestions[Math.min(active, suggestions.length - 1)])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }}
        onKeyUp={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            syncCaret()
            setOpen(false)
          }
        }}
        onClick={() => {
          syncCaret()
          setOpen(false)
        }}
        onScroll={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="h-28 w-full resize-none rounded-lg border border-white/20 bg-white/5 p-3 font-mono text-sm leading-6 text-white outline-none placeholder:text-white/40 focus:border-white/60"
      />
      {visible && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          style={{ left: point.left, top: point.top }}
          className="absolute z-20 max-h-60 w-72 overflow-y-auto rounded-lg border border-line bg-white py-1 text-ink shadow-xl"
        >
          {suggestions.map((item, index) => (
            <li
              key={`${item.category}:${item.name}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault()
                accept(item)
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${index === active ? 'bg-navy-soft' : ''}`}
            >
              <span aria-hidden="true" data-category={item.category} className="palette-swatch" />
              <span className="shrink-0 font-mono text-[13px] font-medium">
                <span className="text-navy">{item.name.slice(0, word.prefix.length)}</span>{item.name.slice(word.prefix.length)}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-subtle">{item.call ? item.detail.replace(/^\w+/, '') : item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
