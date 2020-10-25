import path from 'path'
import checkEnv from '@47ng/check-env'
import { createServer, Server } from 'fastify-micro'
import fastifyStatic from 'fastify-static'
import { MetricsDecoration } from './plugins/metrics'
import { RedisDecoration, checkRedisHealth } from './plugins/redis'
import IORedis from 'ioredis'

export interface App extends Server {
  redis: RedisDecoration
  metrics: MetricsDecoration
}

// --

export default function createApp() {
  checkEnv({
    required: ['REDIS_URI_INGRESS', 'REDIS_URI_RATE_LIMIT']
  })
  const app = createServer<App>({
    name: 'push',
    routesDir: path.resolve(__dirname, 'routes'),
    redactEnv: ['REDIS_URI_INGRESS', 'REDIS_URI_RATE_LIMIT'],
    underPressure: {
      exposeStatusRoute: {
        url: '/',
        routeOpts: {
          logLevel: 'silent'
        }
      },
      healthCheck: async (app: App) => {
        try {
          checkRedisHealth(app.redis.ingress, 'ingress')
          checkRedisHealth(app.redis.rateLimit, 'rate limit')
          return true
        } catch (error) {
          app.log.error(error)
          app.sentry.report(error)
          return false
        }
      }
    },
    configure: app => {
      app.register(require('./plugins/redis').default)
      app.register(require('./plugins/metrics').default)
    }
  })

  app.register(fastifyStatic, {
    root: path.resolve(__dirname, '../public'),
    wildcard: false
  })

  app.addHook('onRequest', (req, res, next) => {
    if (req.raw.url !== '/') {
      // Only apply this hook on /
      return next()
    }
    if (req.headers['x-clevercloud-monitoring'] === 'telegraf') {
      // Forward Clever Cloud health checks to under-pressure
      return next()
    }
    // For everyone else, redirect to the home page
    res.redirect(301, 'https://chiffre.io')
  })

  app.addHook('onClose', async (_, done) => {
    async function closeRedisConnection(con: IORedis.Redis) {
      await con.quit()
      return new Promise(resolve => {
        con.on('end', resolve)
        setTimeout(() => {
          con.disconnect()
        }, 200)
      })
    }
    await Promise.all([
      closeRedisConnection(app.redis.ingress),
      closeRedisConnection(app.redis.rateLimit)
    ])
    done()
  })

  return app
}
