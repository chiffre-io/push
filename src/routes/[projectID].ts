import { FastifyRequest } from 'fastify'
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

interface GetQueryParams extends QueryParams {
  payload: string
}

interface UrlParams {
  projectID: string
}

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 200

// --

async function processIncomingMessage(
  app: App,
  req: FastifyRequest,
  projectID: string,
  payload: string,
  perf: number,
  country?: string
) {
  try {
    app.metrics.increment(Metrics.receivedCount, projectID)
    if (!payload?.startsWith('v1.naclbox.')) {
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
      app.metrics.increment(Metrics.droppedCount, projectID)
      return
    }

    const projectConfig = await getProjectConfig(projectID, app, req)
    if (projectConfig === null) {
      app.metrics.increment(Metrics.invalidProjectConfig, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      return
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
      app.metrics.increment(Metrics.droppedCount, projectID)
      return
    }

    // Check limits
    const now = Date.now()
    const countKey = getProjectKey(projectID, KeyIDs.count)
    const nextMidnightUTC = getNextMidnightUTC(now)
    if (projectConfig.dailyLimit) {
      const usage = parseInt((await app.redis.ingress.get(countKey)) || '0') + 1
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
        app.metrics.increment(Metrics.droppedCount, projectID)
        return
      }
    }

    const messageObject: SerializedMessage = {
      payload,
      perf,
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
    app.metrics.histogram(Metrics.processedPerf, projectID, messageObject.perf)
    app.metrics.histogram(
      Metrics.processedSize,
      projectID,
      messageObject.payload.length
    )
    if (country) {
      app.metrics.histogram(Metrics.processedCountry, projectID, country)
    }
  } catch (error) {
    req.log.error(error)
    app.sentry.report(error, req, {
      projectID
    })
    app.metrics.increment(Metrics.droppedCount, projectID)
  }
}

// --

export default async function projectIDRoutes(app: App) {
  app.register(rateLimit, {
    global: false,
    redis: app.redis.rateLimit,
    keyGenerator: function(req: any) {
      return `push:${req.params.projectID}:${req.id.split('.')[0]}`
    }
  })

  const commonConfig = {
    config: {
      rateLimit: {
        max: RATE_LIMIT_REQUESTS_PER_MINUTE,
        timeWindow: 60_000 // 1 minute
        // todo: Wait for fastify/fastify-rate-limit#77 to merge
        // then use a string again
      }
    }
  }

  app.get<GetQueryParams, UrlParams>(
    '/:projectID',
    commonConfig,
    async (req, res) => {
      const { projectID } = req.params
      const { payload, perf } = req.query
      const country: string | undefined = req.headers['cf-ipcountry']

      await processIncomingMessage(
        app,
        req,
        projectID,
        payload,
        parseInt(perf || '-1') || -1,
        country
      )
      res.header('cache-control', 'private, no-cache, proxy-revalidate')
      return res.status(204).send()
    }
  )

  app.post<QueryParams, UrlParams>(
    '/:projectID',
    commonConfig,
    async (req, res) => {
      const { projectID } = req.params
      const country: string | undefined = req.headers['cf-ipcountry']
      const payload = req.body as string
      const { perf } = req.query
      await processIncomingMessage(
        app,
        req,
        projectID,
        payload,
        parseInt(perf || '-1') || -1,
        country
      )
      return res.status(204).send()
    }
  )
}
