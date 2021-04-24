import checkEnv from '@47ng/check-env'
import { createServer, Server } from 'fastify-micro'
import fastifyStatic from 'fastify-static'
import path from 'path'
import { MetricsDecoration } from './plugins/metrics'
import {
  checkRedisHealth,
  closeRedisConnection,
  RedisDecoration
} from './plugins/redis'

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
          logLevel: 'info'
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
    res.log.info({ msg: 'PING /', headers: req.headers })
    // For everyone else, redirect to the home page
    res.redirect(301, 'https://chiffre.io')
  })

  app.addHook('onClose', async (_, done) => {
    await Promise.all([
      closeRedisConnection(app.redis.ingress),
      closeRedisConnection(app.redis.rateLimit)
    ])
    done()
  })

  return app
}
