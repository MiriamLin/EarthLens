import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { SAVED_DATA_DRAG_TYPE, type DataMetadata, type OperatorInfo } from '../data'
import { fetchJson } from '../lib/api'
import { AlertIcon, ChevronRightIcon } from './Icons'
import FormulaInput from './FormulaInput'
import { GUIDE_EVENT } from './Guide'
import { BLOCK_CATEGORIES, BLOCK_DRAG_TYPE, blockAt, blockCategory, createBlock, numberBlock, placeBlock, readBlockDrag, removeBlock, serializeBlock, type BlockCategory, type BlockPath, type FormulaBlock } from '../lib/formula'

type Props = {
  id: string
  form: string
  value: string
  data: DataMetadata[]
  onChange: (value: string) => void
  headerAction?: ReactNode
  actions?: ReactNode
}

type BlockProps = {
  block: FormulaBlock
  path: BlockPath
  operators: OperatorInfo[]
  selected: BlockPath
  dropTarget: string | null
  label: string
  literal?: boolean
  onSelect: (path: BlockPath) => void
  onDragStart: (path: BlockPath) => void
  onHover: (path: BlockPath, event: DragEvent) => void
  onDrop: (path: BlockPath, event: DragEvent) => void
  onNumber: (path: BlockPath, value: string) => void
}

function pathKey(path: BlockPath) {
  return path.join('.')
}

function acceptsDrag(event: DragEvent) {
  return event.dataTransfer.types.some((type) => type === BLOCK_DRAG_TYPE || type === SAVED_DATA_DRAG_TYPE)
}

function dragOver(event: DragEvent) {
  if (!acceptsDrag(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy'
}

function Block(props: BlockProps) {
  const { block, path, operators, selected, dropTarget, label, literal, onSelect, onDragStart, onHover, onDrop, onNumber } = props
  const spec = operators.find((item) => item.name === block.operation)
  const active = path.length === selected.length && path.every((index, position) => index === selected[position])
  return (
    <div
      className="formula-block"
      data-kind={block.result_type}
      data-category={blockCategory(block.operation, block.result_type)}
      data-selected={active}
      data-drop-target={dropTarget === pathKey(path)}
      data-literal={literal && block.operation === 'number'}
      aria-label={`${spec?.signature || block.value} block`}
      role="group"
      tabIndex={0}
      draggable
      onClick={(event) => { event.stopPropagation(); onSelect(path) }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect(path)
        }
      }}
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.setData(BLOCK_DRAG_TYPE, JSON.stringify({ source: 'workspace', path }))
        event.dataTransfer.effectAllowed = 'move'
        onDragStart(path)
      }}
      onDragOver={(event) => onHover(path, event)}
      onDrop={(event) => onDrop(path, event)}
    >
      <div className="formula-block-body">
        {block.operation === 'number' ? (
          <input
            type="number"
            step="any"
            aria-label={label}
            value={block.value ?? ''}
            onChange={(event) => onNumber(path, event.target.value)}
            className="formula-number w-16 min-w-0 border-0 bg-transparent p-0 text-center text-white outline-none"
          />
        ) : block.operation === 'data' ? <code>{block.value}</code> : (
          <>
            {spec?.syntax === 'function' && <span>{block.operation}(</span>}
            {block.arguments.map((argument, index) => (
              <div key={index} className="flex items-center gap-2">
                {index > 0 && <span>{spec?.syntax === 'infix' ? block.operation : ','}</span>}
                <Block
                  {...props}
                  block={argument}
                  path={[...path, index]}
                  literal={spec?.parameters[index]?.type === 'literal'}
                  label={`${block.operation} ${spec?.parameters[index]?.name || index + 1}`}
                />
              </div>
            ))}
            {spec?.syntax === 'function' && <span>)</span>}
          </>
        )}
      </div>
    </div>
  )
}

export default function FormulaEditor({ id, form, value, data, onChange, headerAction, actions }: Props) {
  const [mode, setMode] = useState<'text' | 'blocks'>('text')
  const [tree, setTree] = useState<FormulaBlock | null>(null)
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [selected, setSelected] = useState<BlockPath>([])
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<BlockCategory[]>(BLOCK_CATEGORIES.map((category) => category.id))
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const dragging = useRef<BlockPath | null>(null)
  const removeDragged = useRef<(path: BlockPath) => void>(() => {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const represented = useRef(value)
  const request = useRef<AbortController | null>(null)
  const dropRequest = useRef<AbortController | null>(null)

  const loadBlocks = useCallback(async (expression: string) => {
    request.current?.abort()
    dropRequest.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const [catalog, parsed] = await Promise.all([
        fetchJson<OperatorInfo[]>('/api/operators', { signal: controller.signal }),
        expression.trim() ? fetchJson<{ tree: FormulaBlock }>('/api/expression/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, body: JSON.stringify({ expression }),
        }) : Promise.resolve({ tree: numberBlock('') }),
      ])
      if (controller.signal.aborted) return
      setOperators(catalog)
      setTree(parsed.tree)
      represented.current = expression
      setSelected([])
      setMode('blocks')
    } catch (error) {
      if (!controller.signal.aborted) {
        setMode('text')
        setError(error instanceof Error ? error.message : 'Unable to load blocks.')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  const latest = useRef({ mode, value, loadBlocks })
  latest.current = { mode, value, loadBlocks }

  useEffect(() => {
    let before: 'text' | 'blocks' | null = null
    function follow(event: Event) {
      const action = (event as CustomEvent<string>).detail
      const { mode: current, value: expression, loadBlocks: load } = latest.current
      if (action === 'start') before = current
      if (action === 'blocks' && current !== 'blocks') void load(expression)
      if (action === 'text' && current !== 'text') setMode('text')
      if (action === 'end') {
        if (before === 'text' && latest.current.mode !== 'text') setMode('text')
        before = null
      }
    }
    window.addEventListener(GUIDE_EVENT, follow)
    return () => window.removeEventListener(GUIDE_EVENT, follow)
  }, [])

  useEffect(() => {
    dropRequest.current?.abort()
    if (mode === 'blocks' && value !== represented.current) void loadBlocks(value)
    if (mode === 'text') {
      request.current?.abort()
      setLoading(false)
    }
  }, [value, mode, loadBlocks])

  useEffect(() => () => {
    request.current?.abort()
    dropRequest.current?.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchJson<OperatorInfo[]>('/api/operators', { signal: controller.signal })
      .then((catalog) => setOperators((current) => current.length ? current : catalog))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (mode !== 'blocks') return
    function finish() {
      dragging.current = null
      setDropTarget(null)
      setRemoving(false)
    }
    function over(event: globalThis.DragEvent) {
      if (!dragging.current || !event.dataTransfer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(null)
      setRemoving(true)
    }
    function release(event: globalThis.DragEvent) {
      const path = dragging.current
      if (!path) return
      event.preventDefault()
      finish()
      removeDragged.current(path)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', release)
    window.addEventListener('dragend', finish)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', release)
      window.removeEventListener('dragend', finish)
    }
  }, [mode])

  function commit(next: FormulaBlock, focus: BlockPath) {
    const expression = serializeBlock(next, operators)
    if (expression.length > 2000) throw new Error('The formula exceeds 2000 characters.')
    dropRequest.current?.abort()
    represented.current = expression
    setTree(next)
    setSelected(focus)
    setError('')
    onChange(expression)
  }

  function insert(block: FormulaBlock, target: BlockPath, source?: BlockPath) {
    if (!tree) return
    try {
      commit(placeBlock(tree, target, block, operators, source), target)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to place block.')
    }
  }

  removeDragged.current = (path: BlockPath) => {
    if (!tree) return
    try {
      commit(removeBlock(tree, path, operators), [])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to remove block.')
    }
  }

  function hover(path: BlockPath, event: DragEvent) {
    if (!acceptsDrag(event)) return
    dragOver(event)
    setDropTarget(pathKey(path))
    setRemoving(false)
  }

  async function drop(target: BlockPath, event: DragEvent) {
    if (!tree || !acceptsDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragging.current = null
    setDropTarget(null)
    setRemoving(false)
    try {
      const saved = event.dataTransfer.getData(SAVED_DATA_DRAG_TYPE)
      if (saved) {
        dropRequest.current?.abort()
        const controller = new AbortController()
        dropRequest.current = controller
        const parsed = await fetchJson<{ tree: FormulaBlock }>('/api/expression/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, body: JSON.stringify({ expression: saved }),
        })
        if (!controller.signal.aborted) insert(parsed.tree, target)
      } else {
        const drag = readBlockDrag(event.dataTransfer.getData(BLOCK_DRAG_TYPE))
        if (drag.source === 'workspace') insert(blockAt(tree, drag.path), target, drag.path)
        else insert(createBlock(drag.operation, operators, drag.value), target)
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setError(error instanceof Error ? error.message : 'Unable to place block.')
      }
    }
  }

  const query = search.trim().toLowerCase()
  const palette = [
    { operation: 'number', value: '0', name: 'Number', result_type: 'number', description: '' },
    ...operators.map((item) => ({ operation: item.name, name: item.signature, result_type: item.result_type, description: item.definition })),
    ...data.map((item) => ({ operation: 'data', value: item.key, name: item.key, result_type: 'number', description: item.name })),
  ]
    .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query))
    .map((item) => ({ ...item, category: blockCategory(item.operation, item.result_type as FormulaBlock['result_type']) }))

  function toggleCategory(category: BlockCategory) {
    setCollapsed((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="flex-1 text-sm font-semibold">Formula</span>
        <div data-tour="ts-mode" role="group" aria-label="Formula input mode" className="flex rounded-lg bg-white/10 p-0.5 text-xs font-medium">
          {(['text', 'blocks'] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={mode === name}
              disabled={loading}
              onClick={() => {
                setError('')
                if (name === 'blocks') void loadBlocks(value)
                else setMode('text')
              }}
              className={`cursor-pointer rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 ${mode === name ? 'bg-white text-navy' : 'text-white/70 hover:text-white'}`}
            >{name === 'text' ? 'Text' : 'Blocks'}</button>
          ))}
        </div>
        {headerAction}
      </div>
      {error && (
        <p role="alert" className="flex shrink-0 items-start gap-2 rounded-lg bg-[#fc3d21]/15 px-3 py-2 text-sm text-[#ffc9bf]">
          <AlertIcon size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {mode === 'text' ? (
        <>
          <FormulaInput
            id={id}
            form={form}
            value={value}
            data={data}
            operators={operators}
            onChange={(next) => { setError(''); onChange(next) }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(SAVED_DATA_DRAG_TYPE)) event.preventDefault()
            }}
            onDrop={(event) => {
              const saved = event.dataTransfer.getData(SAVED_DATA_DRAG_TYPE)
              if (saved) { event.preventDefault(); setError(''); onChange(saved) }
            }}
          />
          <div data-tour="ts-actions" className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        </>
      ) : loading ? <p role="status">Loading blocks...</p> : tree && (
        <>
          <div data-tour="ts-palette" className="flex min-h-0 flex-1 flex-col gap-2 border-b border-white/15 pb-3">
            <input aria-label="Search blocks" placeholder="Search blocks" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 min-w-0 shrink-0 rounded-lg border border-white/20 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/45 focus:border-white/60" />
            <div aria-label="Block palette" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2">
              {palette.length === 0 && <p className="py-2 text-sm text-white/55">No matching blocks.</p>}
              {BLOCK_CATEGORIES.map((category) => {
                const items = palette.filter((item) => item.category === category.id)
                if (!items.length) return null
                const open = query !== '' || !collapsed.includes(category.id)
                return (
                  <section key={category.id} data-category={category.id} aria-label={`${category.label} blocks`}>
                    <button
                      type="button"
                      aria-expanded={open}
                      disabled={query !== ''}
                      onClick={() => toggleCategory(category.id)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm text-white/90 transition-colors hover:bg-white/10 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <ChevronRightIcon size={14} className={`shrink-0 text-white/50 transition-transform ${open ? 'rotate-90' : ''}`} />
                      <span aria-hidden="true" className="palette-swatch" />
                      {category.label}
                      <span className="text-white/45 tabular-nums">{items.length}</span>
                    </button>
                    {open && (
                      <div className="flex flex-wrap gap-2 pt-1 pb-2 pl-6">
                        {items.map((item) => (
                          <button
                            key={`${item.operation}:${'value' in item ? item.value : ''}`}
                            type="button"
                            draggable
                            className="formula-block"
                            data-kind={item.result_type}
                            data-category={item.category}
                            title={item.description}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(BLOCK_DRAG_TYPE, JSON.stringify({ source: 'palette', operation: item.operation, ...('value' in item ? { value: item.value } : {}) }))
                              event.dataTransfer.effectAllowed = 'copy'
                            }}
                            onClick={() => insert(createBlock(item.operation, operators, 'value' in item ? item.value : undefined), selected)}
                          ><span className="formula-block-body">{item.name}</span></button>
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </div>
          <div
            data-tour="ts-blocks"
            aria-label="Formula blocks"
            className={`max-h-40 min-h-16 shrink-0 overflow-auto rounded-lg p-3 transition-colors ${removing ? 'bg-[#fc3d21]/15' : 'bg-white/5'}`}
            onDragOver={(event) => hover([], event)}
            onDrop={(event) => void drop([], event)}
          >
            <Block
              block={tree}
              path={[]}
              operators={operators}
              selected={selected}
              dropTarget={dropTarget}
              label="Number"
              onSelect={setSelected}
              onDragStart={(path) => { dragging.current = path }}
              onHover={hover}
              onDrop={(path, event) => void drop(path, event)}
              onNumber={(path, number) => insert(numberBlock(number), path)}
            />
          </div>
          <p role="status" className={`shrink-0 text-xs ${removing ? 'text-[#ffb4a6]' : 'text-white/55'}`}>
            {removing ? 'Release to remove' : 'Drag outside to remove'}
          </p>
          <div data-tour="ts-actions" className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        </>
      )}
    </div>
  )
}
