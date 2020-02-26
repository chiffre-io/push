import rateLimit from 'fastify-rate-limit'
import { App } from '../server'
import {
  KeyIDs,
  OverLimitStats,
  PubSubChannels,
  SerializedMessage,
  getProjectKey
} from '../exports'
import { getProjectConfig } from '../plugins/redis'
import { getNextMidnightUTC } from '../utility'
import { Metrics } from '../plugins/metrics'

interface QueryParams {
  perf?: string
}

interface UrlParams {
  projectID: string
}

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 200

export default async function projectIDRoute(app: App) {
  app.register(rateLimit, {
    global: false,
    redis: app.redis.rateLimit,
    keyGenerator: function(req: any) {
      return `push:${req.params.projectID}:${req.id.split('.')[0]}`
    }
  })

  app.post<QueryParams, UrlParams>(
    '/:projectID',
    {
      config: {
        rateLimit: {
          max: RATE_LIMIT_REQUESTS_PER_MINUTE,
          timeWindow: 60_000 // 1 minute
          // todo: Wait for fastify/fastify-rate-limit#77 to merge
          // then use a string again
        }
      }
    },
    async (req, res) => {
      const { projectID } = req.params
      const country: string | undefined = req.headers['cf-ipcountry']

      try {
        const projectConfig = await getProjectConfig(projectID, app, req)
        if (projectConfig === null) {
          app.metrics.increment(Metrics.invalidProjectConfig, projectID)
          return res.status(204).send()
        }
        if (
          req.headers['origin'] &&
          !projectConfig.origins.includes(req.headers['origin'])
        ) {
          // Drop invalid origin
          const requestOrigin = req.headers['origin']
          const projectOrigins = projectConfig.origins
          req.log.warn({
            msg: 'Invalid origin',
            projectID,
            requestOrigin,
            projectOrigins
          })
          app.metrics.increment(Metrics.invalidOrigin, projectID)
          app.sentry.report(new Error('Invalid origin'), req, {
            projectID,
            requestOrigin,
            projectOrigins
          })
          return res.status(204).send()
        }

        const payload = req.body as string
        if (!payload.startsWith('v1.naclbox.')) {
          // Drop invalid payload format
          req.log.warn({
            msg: 'Invalid payload format',
            projectID,
            payload
          })
          app.metrics.increment(Metrics.invalidPayload, projectID)
          app.sentry.report(new Error('Invalid payload format'), req, {
            projectID,
            payload
          })
          return res.status(204).send()
        }
        // Check limits
        const now = Date.now()
        const countKey = getProjectKey(projectID, KeyIDs.count)
        const nextMidnightUTC = getNextMidnightUTC(now)
        if (projectConfig.dailyLimit) {
          const usage =
            parseInt((await app.redis.ingress.get(countKey)) || '0') + 1
          if (usage > projectConfig.dailyLimit) {
            const stats: OverLimitStats = {
              projectID,
              usage: usage,
              overUsage: usage - projectConfig.dailyLimit,
              currentTime: now,
              remainingTime: nextMidnightUTC - now
            }
            await app.redis.ingress
              .multi()
              .publish(PubSubChannels.overLimit, JSON.stringify(stats))
              .incr(countKey)
              .pexpireat(countKey, nextMidnightUTC)
              .exec()
            app.metrics.increment(Metrics.overUsageCount, projectID)
            app.metrics.gauge(Metrics.overUsageUsage, projectID, usage)
            app.metrics.gauge(
              Metrics.overUsageRemaining,
              projectID,
              nextMidnightUTC - now
            )
            return res.status(204).send()
          }
        }

        const messageObject: SerializedMessage = {
          payload,
          perf: parseInt(req.query.perf || '-1') || -1,
          received: now,
          country
        }
        const dataKey = getProjectKey(projectID, KeyIDs.data)
        await app.redis.ingress
          .multi()
          .lpush(dataKey, JSON.stringify(messageObject))
          .publish(PubSubChannels.newDataAvailable, dataKey)
          .incr(countKey)
          .pexpireat(countKey, nextMidnightUTC)
          .exec()

        app.metrics.increment(Metrics.processedCount, projectID)
        app.metrics.histogram(
          Metrics.processedPerf,
          projectID,
          messageObject.perf
        )
        app.metrics.histogram(
          Metrics.processedSize,
          projectID,
          messageObject.payload.length
        )
        if (country) {
          app.metrics.histogram(Metrics.processedCountry, projectID, country)
        }
        return res.status(204).send()
      } catch (error) {
        req.log.error(error)
        app.sentry.report(error, req, {
          projectID
        })
        return res.status(204).send()
      }
    }
  )
}
