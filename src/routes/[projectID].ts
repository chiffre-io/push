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

interface QueryParams {
  perf?: string
}

interface UrlParams {
  projectID: string
}

export default async function projectIDRoute(app: App) {
  app.post<QueryParams, UrlParams>('/:projectID', async (req, res) => {
    const { projectID } = req.params
    try {
      const projectConfig = await getProjectConfig(projectID, app, req)
      if (projectConfig === null) {
        return res.status(204).send()
      }
      if (!projectConfig.origins.includes(req.headers['origin'])) {
        // Drop invalid origin
        req.log.warn({
          msg: 'Invalid origin',
          projectID,
          requestOrigin: req.headers['origin'],
          projectOrigins: projectConfig.origins
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
        return res.status(204).send()
      }
      // Check limits
      const now = Date.now()
      const limitKey = getProjectKey(projectID, KeyIDs.limit)
      const nextMidnightUTC = getNextMidnightUTC(now)
      if (projectConfig.dailyLimit) {
        const usage = parseInt((await app.redis.get(limitKey)) || '0') + 1
        if (usage > projectConfig.dailyLimit) {
          const stats: OverLimitStats = {
            projectID,
            usage: usage,
            overUsage: usage - projectConfig.dailyLimit,
            currentTime: now,
            remainingTime: nextMidnightUTC - now
          }
          await app.redis
            .multi()
            .publish(PubSubChannels.overLimit, JSON.stringify(stats))
            .incr(limitKey)
            .expireat(limitKey, nextMidnightUTC / 1000)
            .exec()
          return res.status(204).send()
        }
      }

      const messageObject: SerializedMessage = {
        payload,
        perf: parseInt(req.query.perf || '-1') || -1,
        received: now,
        country: req.headers['cf-ipcountry']
      }
      const dataKey = getProjectKey(projectID, KeyIDs.data)
      await app.redis
        .multi()
        .lpush(dataKey, JSON.stringify(messageObject))
        .publish(PubSubChannels.newDataAvailable, dataKey)
        .incr(limitKey)
        .expireat(limitKey, nextMidnightUTC / 1000)
        .exec()
      return res.status(204).send()
    } catch (error) {
      req.log.error(error)
      app.sentry.report(error, req)
      return res.status(204).send()
    }
  })
}
