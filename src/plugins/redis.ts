import Redis from 'ioredis'
import { FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { App } from '../server'
import { ProjectConfig, getProjectConfigKey } from '../exports'

export default fp(function redisPlugin(app, _, next) {
  const redis = new Redis(process.env.REDIS_URI)
  redis.on('error', error => {
    app.log.error({
      msg: `Redis error`,
      plugin: 'redis',
      error
    })
    ;(app as App).sentry.report(error)
  })
  app.decorate('redis', redis)
  next()
})

// --

export async function getProjectConfig(
  projectID: string,
  app: App,
  req?: FastifyRequest
): Promise<ProjectConfig | null> {
  const key = getProjectConfigKey(projectID)
  try {
    const json = await app.redis.get(key)
    if (!json) {
      throw new Error('Project configuration not found')
    }
    return JSON.parse(json)
  } catch (error) {
    req?.log.warn({
      err: error,
      projectID
    })
    app.sentry.report(error, req)
    return null
  }
}
