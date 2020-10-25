import { setup, TestContext } from './utility'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setup()
}, 10000)

afterAll(async () => {
  await ctx.redis.quit()
  await ctx.server.close()
  ctx.redis.disconnect()
})

// -----------------------------------------------------------------------------

test('Redis failure on get', async () => {
  ctx.server.redis.ingress.get = () => {
    throw new Error('oh no')
  }
  const res = await ctx.api.post('/event/bar', 'gibberish')
  expect(res.status).toEqual(204)
})
