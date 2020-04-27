import { importKeys, decryptString } from '@chiffre/crypto-box'
import { setup, TestContext } from './utility'
import {
  ProjectConfig,
  SerializedMessage,
  PubSubChannels,
  OverLimitStats
} from '../src/exports'
import { getProjectConfig } from '../src/plugins/redis'
import { RATE_LIMIT_REQUESTS_PER_MINUTE } from '../src/routes/[projectID]'

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

test('Push invalid data', async () => {
  const res = await ctx.api.post('/event/foo', 'gibberish')
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

test('Push to unexisting project', async () => {
  const res = await ctx.api.post('/event/doesnotexist', 'v1.naclbox.payload')
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('doesnotexist.data')
  expect(data).toBe(0)
})

test('Push from invalid origin', async () => {
  const res = await ctx.api.post('/event/foo', 'v1.naclbox.foobar', {
    headers: {
      origin: 'https://egg.com'
    }
  })
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(0)
})

test('Push from localhost should be ignored', async () => {
  const res = await ctx.api.post('/event/foo', 'v1.naclbox.foobar', {
    headers: {
      origin: 'http://localhost:1234'
    }
  })
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(0)
})

test('Push valid data', async () => {
  const tick = Date.now()
  const res = await ctx.api.post('/event/foo', 'v1.naclbox.foobar', {
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

test('Push from missing origin is accepted', async () => {
  const res = await ctx.api.post('/event/foo', 'v1.naclbox.foobar')
  expect(res.status).toEqual(204)
  const data = await ctx.redis.llen('foo.data')
  expect(data).toBe(1)
})

test('Publish new data notification', async () => {
  await ctx.redis.subscribe(PubSubChannels.newDataAvailable)
  const onMessage = jest.fn()
  ctx.redis.on('message', onMessage)
  await ctx.api.post('/event/foo', 'v1.naclbox.foobar', {
    headers: {
      origin: 'https://foo.com'
    }
  })
  expect(onMessage).toHaveBeenCalledTimes(1)
  expect(onMessage.mock.calls[0][0]).toEqual(PubSubChannels.newDataAvailable)
  expect(onMessage.mock.calls[0][1]).toEqual('foo.data')
  await ctx.redis.unsubscribe(PubSubChannels.newDataAvailable)
})

test('Limits - Push message under limit', async () => {
  const config: ProjectConfig = {
    origins: ['https://bar.com'],
    dailyLimit: 2
  }
  await ctx.redis.set('bar.config', JSON.stringify(config))
  await ctx.redis.subscribe(PubSubChannels.newDataAvailable)
  const onMessage = jest.fn()
  ctx.redis.on('message', onMessage)
  await ctx.api.post('/event/bar', 'v1.naclbox.msg1', {
    headers: {
      origin: 'https://bar.com'
    }
  })
  await ctx.api.post('/event/bar', 'v1.naclbox.msg2', {
    headers: {
      origin: 'https://bar.com'
    }
  })
  await ctx.redis.unsubscribe(PubSubChannels.newDataAvailable)
  expect(onMessage).toHaveBeenCalledTimes(2)
  expect(onMessage.mock.calls[0][0]).toEqual(PubSubChannels.newDataAvailable)
  expect(onMessage.mock.calls[0][1]).toEqual('bar.data')
  expect(onMessage.mock.calls[1][0]).toEqual(PubSubChannels.newDataAvailable)
  expect(onMessage.mock.calls[1][1]).toEqual('bar.data')
  const usage = parseInt((await ctx.redis.get('bar.count')) || '0')
  expect(await ctx.redis.llen('bar.data')).toEqual(2)
  expect(usage).toEqual(2)
})

test('Limits - Push message over limit - does not call newDataAvailable', async () => {
  await ctx.redis.subscribe(PubSubChannels.newDataAvailable)
  const onMessage = jest.fn()
  ctx.redis.on('message', onMessage)
  await ctx.api.post('/event/bar', 'v1.naclbox.msg3', {
    headers: {
      origin: 'https://bar.com'
    }
  })
  await ctx.redis.unsubscribe(PubSubChannels.newDataAvailable)
  expect(onMessage).not.toHaveBeenCalled()
  const usage = parseInt((await ctx.redis.get('bar.count')) || '0')
  expect(usage).toEqual(3)
  expect(await ctx.redis.llen('bar.data')).toEqual(2) // Extra messages are dropped
})

test('Limits - Push message over limit - calls overLimit', async () => {
  await ctx.redis.subscribe(PubSubChannels.overLimit)
  const onMessage = jest.fn()
  ctx.redis.on('message', onMessage)
  await ctx.api.post('/event/bar', 'v1.naclbox.msg4', {
    headers: {
      origin: 'https://bar.com'
    }
  })
  await ctx.redis.unsubscribe(PubSubChannels.overLimit)
  expect(onMessage).toHaveBeenCalledTimes(1)
  const stats: OverLimitStats = JSON.parse(onMessage.mock.calls[0][1])
  expect(stats.usage).toEqual(4)
  expect(stats.overUsage).toEqual(2)
  expect(stats.projectID).toEqual('bar')
})

test('Rate Limit should impact projects independently', async () => {
  const config: ProjectConfig = {
    origins: ['https://egg.com'],
    dailyLimit: 2
  }
  await ctx.redis.set('egg.config', JSON.stringify(config))
  for (let i = 0; i < RATE_LIMIT_REQUESTS_PER_MINUTE; ++i) {
    const res = await ctx.api.post('/event/egg', 'v1.naclbox.egg', {
      headers: {
        origin: 'https://egg.com'
      }
    })
    expect(res.status).toEqual(204)
  }
  {
    const res = await ctx.api.post('/event/egg', 'v1.naclbox.egg', {
      headers: {
        origin: 'https://egg.com'
      }
    })
    expect(res.status).toEqual(429) // Too many requests
  }
  {
    const res = await ctx.api.post('/event/bar', 'v1.naclbox.bar', {
      headers: {
        origin: 'https://bar.com'
      }
    })
    expect(res.status).toEqual(204)
  }
})

test('Push via a GET request', async () => {
  const config: ProjectConfig = {
    origins: ['https://spam.com']
  }
  await ctx.redis.set('spam.config', JSON.stringify(config))
  await ctx.api.get('/event/spam?payload=v1.naclbox.test')
  expect(await ctx.redis.llen('spam.data')).toEqual(1)
})

test('Perf via query string', async () => {
  await ctx.api.post('/event/spam?perf=42', 'v1.naclbox.spam')
  const obj = JSON.parse(await ctx.redis.lpop('spam.data'))
  expect(obj.perf).toEqual(42)
})

test('noscript route should create an encrypted message', async () => {
  const secretKey = 'sk.eW95GIlOPGIHnfFSpaWuQuNJ03s5I_mOZSBczlEI2G4'
  const keys = importKeys(secretKey)
  const config: ProjectConfig = {
    origins: ['https://tofu.com'],
    publicKey: keys.public
  }
  await ctx.redis.set('tofu.config', JSON.stringify(config))
  await ctx.api.get('/noscript/tofu')
  expect(await ctx.redis.llen('tofu.data')).toEqual(1)
  const message: SerializedMessage = JSON.parse(
    await ctx.redis.lpop('tofu.data')
  )
  expect(message.perf).toEqual(-1)
  const event = JSON.parse(decryptString(message.payload, keys.raw.secretKey))
  expect(event.type).toEqual('session:noscript')
  expect(event.data).toEqual(null)
})
