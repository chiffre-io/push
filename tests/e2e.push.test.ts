import { setup, TestContext } from './utility'
import { ProjectConfig, SerializedMessage } from '../src/exports'
import { getProjectConfig } from '../src/plugins/redis'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setup()
}, 10000)

afterAll(async () => {
  await ctx.redis.quit()
  await ctx.server.close()
})

// -----------------------------------------------------------------------------

test('Health check', async () => {
  const res = await ctx.api.get('/')
  expect(res.status).toEqual(200)
})

test('Push to unexisting project', async () => {
  const res = await ctx.api.post('/foo', 'gibberish')
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(0)
})

test('Get project config', async () => {
  const expected: ProjectConfig = {
    origins: ['https://foo.com', 'https://bar.com']
  }
  await ctx.redis.set('foo.config', JSON.stringify(expected))
  const received = await getProjectConfig('foo', ctx.server)
  expect(received).toEqual(expected)
})

test('Push from invalid origin', async () => {
  const res = await ctx.api.post('/foo', 'gibberish', {
    headers: {
      origin: 'https://egg.com'
    }
  })
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(0)
})

test('Push invalid data', async () => {
  const res = await ctx.api.post('/foo', 'gibberish', {
    headers: {
      origin: 'https://foo.com'
    }
  })
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(0)
})

test('Push valid data', async () => {
  const tick = Date.now()
  const res = await ctx.api.post('/foo', 'v1.naclbox.foobar', {
    headers: {
      origin: 'https://foo.com'
    }
  })
  const tock = Date.now()
  expect(res.status).toEqual(204)
  expect(await ctx.redis.llen('foo.data')).toBe(1)
  const data: SerializedMessage = JSON.parse(await ctx.redis.lpop('foo.data'))
  expect(data.payload).toEqual('v1.naclbox.foobar')
  expect(data.perf).toEqual(-1)
  expect(data.received).toBeGreaterThanOrEqual(tick)
  expect(data.received).toBeLessThanOrEqual(tock)
})
