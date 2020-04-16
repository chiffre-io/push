import { App } from '../server'

export default async function spamRoutes(app: App) {
  const routes = [
    '/wp-login.php',
    '/data.zip',
    '/bak.rar',
    '/web.rar',
    '/www.rar',
    '/db.zip',
    '/backup.7z'
  ]
  for (const route of routes) {
    app.get(
      route,
      {
        logLevel: 'silent'
      },
      (_req, res) => {
        res.status(204).send()
      }
    )
  }
}
