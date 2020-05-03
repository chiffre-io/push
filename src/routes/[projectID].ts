import { FastifyRequest } from 'fastify'
import rateLimit from 'fastify-rate-limit'
import { encryptString, parsePublicKey } from '@chiffre/crypto-box'
import { createBrowserEvent } from '@chiffre/analytics-core'
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
  v?: string
  xhr?: string
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
  req: FastifyRequest<any, QueryParams>,
  projectID: string,
  payload: string,
  country?: string
) {
  const perf = parseInt(req.query.perf || '-1') || -1
  const trackerVersion = req.query.v
  const trackerXHR = req.query.xhr
  try {
    app.metrics.increment(Metrics.receivedCount, projectID)
    app.metrics.histogram(
      Metrics.trackerScriptVersion,
      projectID,
      trackerVersion
    )
    app.metrics.histogram(Metrics.xhrType, projectID, trackerXHR)
    app.metrics.histogram(Metrics.dnt, projectID, req.headers.dnt === '1')
    if (payload === undefined) {
      req.log.warn({
        msg: 'Missing payload',
        projectID,
        payload,
        trackerVersion,
        trackerXHR
      })
      app.metrics.increment(Metrics.missingPayload, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      app.sentry.report(new Error('Missing payload'), req, {
        tags: {
          projectID,
          trackerVersion: trackerVersion || 'unknown',
          trackerXHR: trackerXHR || 'unknown'
        }
      })
      return
    }
    if (!payload.startsWith('v1.naclbox.')) {
      // Drop invalid payload format
      req.log.error({
        msg: 'Invalid payload format',
        projectID,
        payload,
        trackerVersion,
        trackerXHR
      })
      app.metrics.increment(Metrics.invalidPayload, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      app.sentry.report(new Error('Invalid payload format'), req, {
        tags: {
          projectID,
          payload,
          trackerVersion: trackerVersion || 'unknown',
          trackerXHR: trackerXHR || 'unknown'
        }
      })
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
      const requestOrigin: string = req.headers['origin']
      const projectOrigins = projectConfig.origins
      if (requestOrigin.match(/^http(s)?:\/\/(localhost|127\.0\.0\.1)/)) {
        // Ignore localhost (tracking script used in development)
        req.log.warn({
          msg: 'Ignoring localhost origin',
          projectID,
          requestOrigin,
          projectOrigins,
          trackerVersion,
          trackerXHR
        })
        app.metrics.increment(Metrics.droppedCount, projectID)
        return
      }
      // Drop invalid origin
      req.log.warn({
        msg: 'Invalid origin',
        projectID,
        requestOrigin,
        projectOrigins,
        trackerVersion,
        trackerXHR
      })
      app.metrics.increment(Metrics.invalidOrigin, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      app.sentry.report(new Error('Invalid origin'), req, {
        tags: {
          projectID,
          requestOrigin,
          trackerVersion: trackerVersion || 'unknown',
          trackerXHR: trackerXHR || 'unknown'
        },
        context: {
          projectOrigins
        }
      })
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
        app.metrics.increment(Metrics.droppedCount, projectID)
        app.metrics.increment(Metrics.overUsageCount, projectID)
        app.metrics.gauge(Metrics.overUsageUsage, projectID, usage)
        app.metrics.gauge(
          Metrics.overUsageRemaining,
          projectID,
          nextMidnightUTC - now
        )
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
    app.metrics.increment(Metrics.droppedCount, projectID)
    app.sentry.report(error, req, {
      tags: {
        projectID,
        trackerVersion: trackerVersion || 'unknown',
        trackerXHR: trackerXHR || 'unknown'
      }
    })
  }
}

// --

export default async function projectIDRoutes(app: App) {
  app.register(rateLimit, {
    global: false,
    redis: app.redis.rateLimit,
    keyGenerator: (req: any) => {
      return `push:${req.params.projectID}:${req.id.split('.')[0]}`
    }
  })

  const commonConfig = {
    config: {
      rateLimit: {
        max: RATE_LIMIT_REQUESTS_PER_MINUTE,
        timeWindow: 60_000 // 1 minute
      }
    }
  }

  app.get<GetQueryParams, UrlParams>(
    '/event/:projectID',
    commonConfig,
    async (req, res) => {
      res.header('cache-control', 'private, no-cache, proxy-revalidate')
      const { projectID } = req.params
      const { payload } = req.query
      const country: string | undefined = req.headers['cf-ipcountry']
      // Ignore badly-written Bing scrapers
      if (
        req.headers['user-agent'] ===
          'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b' &&
        !!payload &&
        !!req.body
      ) {
        return res.status(204).send()
      }
      await processIncomingMessage(
        app,
        req,
        projectID,
        payload || req.body,
        country
      )
      return res.status(204).send()
    }
  )

  app.post<QueryParams, UrlParams>(
    '/event/:projectID',
    commonConfig,
    async (req, res) => {
      const { projectID } = req.params
      const country: string | undefined = req.headers['cf-ipcountry']
      const payload = req.body as string
      await processIncomingMessage(app, req, projectID, payload, country)
      return res.status(204).send()
    }
  )

  /**
   * This route helps getting some visit counts from clients without
   * JavaScript enabled. An image is placed in a <noscript> section,
   * which will hit this route.
   * We then create an encrypted event on the server, containing nothing
   * but the event type session:noscript.
   * We assume that not having JS enabled reflects a desire for ultimate
   * privacy (although ironically it makes E2EE impossible), so we treat
   * it as a DNT event, but with a different type for distinction.
   */
  app.get('/noscript/:projectID', commonConfig, async (req, res) => {
    const { projectID } = req.params
    const projectConfig = await getProjectConfig(projectID, app, req)
    if (projectConfig === null) {
      app.metrics.increment(Metrics.invalidProjectConfig, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      return res.status(204).send()
    }
    if (!projectConfig.publicKey) {
      req.log.warn({
        msg: 'Missing public key in Redis config',
        projectID
      })
      app.metrics.increment(Metrics.invalidProjectConfig, projectID)
      app.metrics.increment(Metrics.droppedCount, projectID)
      return res.status(204).send()
    }
    const payloadEvent = createBrowserEvent('session:noscript', null)
    const publicKey = parsePublicKey(projectConfig.publicKey)
    const payload = encryptString(JSON.stringify(payloadEvent), publicKey)
    req.query.xhr = 'noscript'
    const country: string | undefined = req.headers['cf-ipcountry']
    await processIncomingMessage(app, req, projectID, payload, country)
    res.header('cache-control', 'private, no-cache, proxy-revalidate')
    return res.status(204).send()
  })
}
