import { App } from '../server'
import { SerializedMessage } from '../types'
import { getProjectConfig, getProjectDataKey } from '../plugins/redis'

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
      const messageObject: SerializedMessage = {
        payload,
        perf: parseInt(req.query.perf || '-1') || -1,
        received: Date.now(),
        country: req.headers['cf-ipcountry']
      }
      const dataKey = getProjectDataKey(projectID)
      await app.redis.lpush(dataKey, JSON.stringify(messageObject))
      return res.status(204).send()
    } catch (error) {
      req.log.error(error)
      app.sentry.report(error, req)
      return res.status(204).send()
    }
  })
}
