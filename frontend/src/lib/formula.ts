import type { OperatorInfo } from '../data.ts'

export type FormulaBlock = {
  operation: string
  arguments: FormulaBlock[]
  value?: string | number | null
  result_type: 'number' | 'boolean'
}

export type BlockPath = number[]
export type BlockInput = 'number' | 'boolean' | 'literal' | 'result'
export type BlockDrag =
  | { source: 'palette'; operation: string; value?: string }
  | { source: 'workspace'; path: BlockPath }

export const BLOCK_DRAG_TYPE = 'application/x-earthlens-block'

export const BLOCK_CATEGORIES = [
  { id: 'number', label: 'Number' },
  { id: 'arithmetic', label: 'Arithmetic' },
  { id: 'time', label: 'Time series' },
  { id: 'math', label: 'Math' },
  { id: 'logic', label: 'Comparison & logic' },
  { id: 'data', label: 'Data' },
] as const

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]['id']

const ARITHMETIC = ['+', '-', '*', '/']

export function blockCategory(operation: string, resultType: 'number' | 'boolean' = 'number'): BlockCategory {
  if (operation === 'number' || operation === 'data') return operation
  if (ARITHMETIC.includes(operation)) return 'arithmetic'
  if (operation.startsWith('ts_')) return 'time'
  if (resultType === 'boolean' || operation === 'if_else') return 'logic'
  return 'math'
}

export function numberBlock(value: string | number): FormulaBlock {
  return { operation: 'number', arguments: [], value, result_type: 'number' }
}

function defaultInput(type: BlockInput, value: number, operators: OperatorInfo[]): FormulaBlock {
  if (type !== 'boolean') return numberBlock(value)
  const comparison = operators.find((item) => item.result_type === 'boolean' && item.syntax === 'infix')
  if (!comparison) throw new Error('No condition blocks are available.')
  return createBlock(comparison.name, operators)
}

export function createBlock(operation: string, operators: OperatorInfo[], value?: string): FormulaBlock {
  if (operation === 'number') return numberBlock(value ?? 0)
  if (operation === 'data') return { operation, arguments: [], value, result_type: 'number' }
  const spec = operators.find((item) => item.name === operation)
  if (!spec) throw new Error('Unknown block.')
  return {
    operation,
    result_type: spec.result_type,
    arguments: spec.parameters.map((parameter) => defaultInput(parameter.type, parameter.default, operators)),
  }
}

export function serializeBlock(block: FormulaBlock, operators: OperatorInfo[]): string {
  if (block.operation === 'data' || block.operation === 'number') return String(block.value ?? '')
  const spec = operators.find((item) => item.name === block.operation)
  if (!spec) throw new Error('Unknown block.')
  const arguments_ = block.arguments.map((argument) => serializeBlock(argument, operators))
  return spec.syntax === 'infix'
    ? `(${arguments_[0]} ${block.operation} ${arguments_[1]})`
    : `${block.operation}(${arguments_.join(', ')})`
}

export function blockAt(tree: FormulaBlock, path: BlockPath): FormulaBlock {
  let block = tree
  for (const index of path) {
    if (!Number.isInteger(index) || !block.arguments[index]) throw new Error('This block is no longer available.')
    block = block.arguments[index]
  }
  return block
}

function parameterAt(tree: FormulaBlock, path: BlockPath, operators: OperatorInfo[]) {
  const parent = blockAt(tree, path.slice(0, -1))
  const parameter = operators.find((item) => item.name === parent.operation)?.parameters[path[path.length - 1]]
  if (!parameter) throw new Error('Unknown block input.')
  return parameter
}

export function inputAt(tree: FormulaBlock, path: BlockPath, operators: OperatorInfo[]): BlockInput {
  return path.length ? parameterAt(tree, path, operators).type : 'result'
}

function replaceAt(tree: FormulaBlock, path: BlockPath, block: FormulaBlock): FormulaBlock {
  if (!path.length) return block
  const [index, ...rest] = path
  blockAt(tree, [index])
  return { ...tree, arguments: tree.arguments.map((child, position) => position === index ? replaceAt(child, rest, block) : child) }
}

function isPrefix(prefix: BlockPath, path: BlockPath) {
  return prefix.length <= path.length && prefix.every((index, position) => index === path[position])
}

function depth(block: FormulaBlock): number {
  return 1 + Math.max(0, ...block.arguments.map(depth))
}

export function placeBlock(tree: FormulaBlock, target: BlockPath, block: FormulaBlock, operators: OperatorInfo[], source?: BlockPath): FormulaBlock {
  const expected = inputAt(tree, target, operators)
  if (expected === 'literal' ? block.operation !== 'number' : expected !== 'result' && expected !== block.result_type) {
    throw new Error(expected === 'literal' ? 'This input requires a fixed number.' : `This input requires a ${expected} block.`)
  }
  let next = tree
  if (source) {
    if (source.length === target.length && isPrefix(source, target)) return tree
    if (isPrefix(source, target)) throw new Error('A block cannot be placed inside itself.')
    if (!isPrefix(target, source)) {
      const parameter = parameterAt(tree, source, operators)
      next = replaceAt(next, source, defaultInput(parameter.type, parameter.default, operators))
    }
  }
  next = replaceAt(next, target, block)
  if (depth(next) > 32) throw new Error('The formula is nested too deeply.')
  return next
}

export function removeBlock(tree: FormulaBlock, path: BlockPath, operators: OperatorInfo[]): FormulaBlock {
  if (!path.length) return numberBlock('')
  const parameter = parameterAt(tree, path, operators)
  return replaceAt(tree, path, defaultInput(parameter.type, parameter.default, operators))
}

export function readBlockDrag(value: string): BlockDrag {
  const drag = JSON.parse(value)
  if (drag?.source === 'palette' && typeof drag.operation === 'string'
    && (drag.value === undefined || typeof drag.value === 'string')) return drag
  if (drag?.source === 'workspace' && Array.isArray(drag.path) && drag.path.length <= 32
    && drag.path.every((index: unknown) => Number.isInteger(index) && Number(index) >= 0)) return drag
  throw new Error('Unsupported block.')
}
