import assert from 'node:assert/strict'
import test from 'node:test'
import { blockAt, createBlock, inputAt, numberBlock, placeBlock, readBlockDrag, serializeBlock } from '../src/lib/formula.ts'

function spec(name, parameters, syntax = 'function', result_type = 'number') {
  return {
    name, syntax, result_type, definition: name, signature: name,
    parameters: parameters.map(([name, type = 'number', value = 0]) => ({ name, type, default: value })),
  }
}

const operators = [
  spec('+', [['x'], ['y']], 'infix'), spec('-', [['x'], ['y']], 'infix'),
  spec('>', [['x'], ['y']], 'infix', 'boolean'), spec('==', [['x'], ['y']], 'infix', 'boolean'),
  spec('if_else', [['condition', 'boolean'], ['true_value', 'number', 1], ['false_value']]),
  spec('ts_mean', [['x'], ['d', 'literal', 30]]),
  spec('ts_quantile', [['x'], ['d', 'literal', 30], ['q', 'literal', 0.5]]),
  spec('pow', [['x'], ['p', 'literal', 2]]),
]
const data = (key = 'T2M') => createBlock('data', operators, key)

test('nested conditional blocks serialize to the same formula used by text mode', () => {
  let tree = createBlock('if_else', operators)
  tree = placeBlock(tree, [0, 0], data(), operators)
  tree = placeBlock(tree, [0, 1], numberBlock(35), operators)
  assert.equal(serializeBlock(tree, operators), 'if_else((T2M > 35), 1, 0)')
  assert.equal(tree.result_type, 'number')
  assert.equal(blockAt(tree, [0]).result_type, 'boolean')
})

test('serialization preserves nested arithmetic order, negative numbers and literal arguments', () => {
  assert.equal(serializeBlock(numberBlock(''), operators), '')
  let tree = createBlock('-', operators)
  tree = placeBlock(tree, [0], data(), operators)
  let inner = createBlock('+', operators)
  inner = placeBlock(inner, [0], data('T2M_MAX'), operators)
  inner = placeBlock(inner, [1], numberBlock(-2), operators)
  tree = placeBlock(tree, [1], inner, operators)
  assert.equal(serializeBlock(tree, operators), '(T2M - (T2M_MAX + -2))')
  let quantile = createBlock('ts_quantile', operators)
  quantile = placeBlock(quantile, [0], tree, operators)
  quantile = placeBlock(quantile, [2], numberBlock(0.25), operators)
  assert.equal(serializeBlock(quantile, operators), 'ts_quantile((T2M - (T2M_MAX + -2)), 30, 0.25)')
})

test('Boolean, numeric and fixed numeric slots reject incompatible blocks', () => {
  const tree = createBlock('if_else', operators)
  assert.throws(() => placeBlock(tree, [0], data(), operators), /boolean block/)
  assert.throws(() => placeBlock(tree, [1], createBlock('>', operators), operators), /number block/)
  const mean = createBlock('ts_mean', operators)
  assert.equal(inputAt(mean, [1], operators), 'literal')
  assert.throws(() => placeBlock(mean, [1], data(), operators), /fixed number/)
  assert.equal(placeBlock(mean, [1], numberBlock(7), operators).arguments[1].value, 7)
  assert.equal(placeBlock(mean, [], createBlock('>', operators), operators).result_type, 'boolean')
})

test('moving a block between sibling inputs removes the source without mutating the original', () => {
  const original = placeBlock(createBlock('+', operators), [0], data(), operators)
  const snapshot = structuredClone(original)
  const moved = placeBlock(original, [1], blockAt(original, [0]), operators, [0])
  assert.equal(serializeBlock(moved, operators), '(0 + T2M)')
  assert.deepEqual(original, snapshot)
})

test('a child can replace its ancestor while ancestors cannot be dropped into themselves', () => {
  const tree = placeBlock(createBlock('ts_mean', operators), [0], data(), operators)
  assert.equal(serializeBlock(placeBlock(tree, [], blockAt(tree, [0]), operators, [0]), operators), 'T2M')
  assert.throws(() => placeBlock(tree, [0], tree, operators, []), /inside itself/)
  assert.equal(placeBlock(tree, [], tree, operators, []), tree)
})

test('moving a literal restores the original parameter default', () => {
  const tree = placeBlock(createBlock('ts_mean', operators), [0], data(), operators)
  const moved = placeBlock(tree, [0], blockAt(tree, [1]), operators, [1])
  assert.equal(serializeBlock(moved, operators), 'ts_mean(30, 30)')
})

test('moving a condition leaves a valid Boolean condition at its old input', () => {
  let tree = createBlock('if_else', operators)
  tree = placeBlock(tree, [0, 0], data(), operators)
  tree = placeBlock(tree, [1], createBlock('if_else', operators), operators)
  tree = placeBlock(tree, [1, 0], blockAt(tree, [0]), operators, [0])
  assert.equal(blockAt(tree, [0]).result_type, 'boolean')
  assert.equal(blockAt(tree, [1, 0, 0]).value, 'T2M')
  assert.equal(serializeBlock(tree, operators), 'if_else((0 > 0), if_else((T2M > 0), 1, 0), 0)')
})

test('block input paths and nesting limits protect the current formula', () => {
  const tree = createBlock('ts_mean', operators)
  assert.throws(() => placeBlock(tree, [8], data(), operators), /Unknown block input/)
  assert.throws(() => blockAt(tree, [-1]), /no longer available/)
  let deep = data()
  for (let index = 0; index < 32; index++) deep = { ...tree, arguments: [deep, numberBlock(3)] }
  assert.throws(() => placeBlock(tree, [], deep, operators), /nested too deeply/)
  assert.equal(tree.arguments[0].value, 0)
})

test('drag payloads describe palette entries or existing paths without accepting arbitrary trees', () => {
  const palette = { source: 'palette', operation: 'data', value: 'T2M' }
  assert.deepEqual(readBlockDrag(JSON.stringify(palette)), palette)
  assert.deepEqual(readBlockDrag('{"source":"workspace","path":[0,1]}'), { source: 'workspace', path: [0, 1] })
  for (const value of ['null', '{}', '{"source":"workspace","path":[-1]}', '{"source":"workspace","path":[0.5]}', '{"source":"palette","operation":true}']) {
    assert.throws(() => readBlockDrag(value))
  }
  assert.throws(() => createBlock('__import__', operators), /Unknown block/)
})
