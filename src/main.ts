import dotenv from 'dotenv'
import envAlias from 'env-alias'
import createServer from './server'
import { startServer } from 'fastify-micro'

// -----------------------------------------------------------------------------

if (require.main === module) {
  // Setup environment
  dotenv.config()
  envAlias()

  const server = createServer()
  startServer(server)
}
