import assert from 'node:assert/strict'
import test from 'node:test'
import { geoArea } from 'd3-geo'
import { createMapCells, mapColor, mapPath } from '../src/lib/map.ts'

test('648 ten-degree cells cover the full globe without gaps', () => {
  const cells = createMapCells()
  assert.equal(cells.length, 648)
  assert.deepEqual([cells[0].west, cells[0].south], [-180, -90])
  assert.deepEqual([cells[647].east, cells[647].north], [180, 90])
  let area = 0
  for (const cell of cells) {
    assert.equal(cell.east - cell.west, 10)
    assert.equal(cell.north - cell.south, 10)
    assert.deepEqual(cell.geometry.coordinates[0][0], cell.geometry.coordinates[0].at(-1))
    const size = geoArea(cell.geometry)
    assert.ok(size > 0 && size < 0.04)
    area += size
    assert.ok(mapPath(cell.geometry))
  }
  assert.ok(Math.abs(area - 4 * Math.PI) < 1e-10)
})

test('the projection preserves the smaller area of polar cells', () => {
  const cells = createMapCells()
  assert.ok(geoArea(cells[9 * 36 + 18].geometry) > 10 * geoArea(cells[17 * 36 + 18].geometry))
})

test('higher values are darker and missing values stay transparent', () => {
  assert.equal(mapColor(0, 0, 10), 'rgb(239,246,255)')
  assert.equal(mapColor(10, 0, 10), 'rgb(30,58,138)')
  assert.equal(mapColor(null, 0, 10), 'transparent')
  assert.equal(mapColor(undefined, 0, 10), 'transparent')
  assert.equal(mapColor(NaN, 0, 10), 'transparent')
  assert.equal(mapColor(5, 5, 5), 'rgb(135,152,197)')
})
