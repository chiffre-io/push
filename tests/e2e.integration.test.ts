import {
  getProjectConfigKey,
  getProjectIDFromConfigKey,
  getProjectIDFromDataKey,
  getProjectDataKey
} from '../src/exports'

test('Config keys', () => {
  const expected = 'foobar'
  const received = getProjectIDFromConfigKey(getProjectConfigKey(expected))
  expect(received).toEqual(expected)
})

test('Data keys', () => {
  const expected = 'foobar'
  const received = getProjectIDFromDataKey(getProjectDataKey(expected))
  expect(received).toEqual(expected)
})
