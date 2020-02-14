import { setup, TestContext } from './utility'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setup()
}, 10000)

afterAll(async () => {
  await ctx.redis.quit()
  await ctx.server.close()
})

// -----------------------------------------------------------------------------

test('Redis failure on get', async () => {
  ctx.server.redis.get = () => {
    throw new Error('oh no')
  }
  const res = await ctx.api.post('/bar', 'gibberish')
  expect(res.status).toEqual(204)
})
