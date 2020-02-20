import { getProjectKey, getProjectIDFromKey, KeyIDs } from '../src/exports'
import { getNextMidnightUTC, dayjs } from '../src/utility'

test('Config keys', () => {
  const expected = 'foobar'
  const received = getProjectIDFromKey(getProjectKey(expected, KeyIDs.config))
  expect(received).toEqual(expected)
})

test('Data keys', () => {
  const expected = 'foobar'
  const received = getProjectIDFromKey(getProjectKey(expected, KeyIDs.data))
  expect(received).toEqual(expected)
})

test('Limit keys', () => {
  const expected = 'foobar'
  const received = getProjectIDFromKey(getProjectKey(expected, KeyIDs.limit))
  expect(received).toEqual(expected)
})

test('Get next midnight UTC', () => {
  const first = getNextMidnightUTC(dayjs('2020-01-01T00:00:00.000Z').valueOf())
  expect(dayjs(first).toISOString()).toEqual('2020-01-02T00:00:00.000Z')
  const last = getNextMidnightUTC(dayjs('2020-01-01T23:59:59.999Z').valueOf())
  expect(dayjs(last).toISOString()).toEqual('2020-01-02T00:00:00.000Z')
  const next = getNextMidnightUTC(dayjs('2020-01-01T24:00:00.000Z').valueOf())
  expect(dayjs(next).toISOString()).toEqual('2020-01-03T00:00:00.000Z')
})
