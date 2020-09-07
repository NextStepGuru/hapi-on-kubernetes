exports.register = function (server, _config) {
  process.env.IS_SHUTDOWN_REQUESTED = 'false'

  const config = {
    restartHapiOnUnhandledError: false,
    shutdownTimeout: 60 * 1000,
    livenessProbeEndpoint: '/liveness',
    heartbeatProbeEndpoint: '/heartbeat',
    readinessProbeEndpoint: '/readiness',
    showDebug: false,
    startupRoutine() {},
    shutdownRoutine() {},
    ..._config,
  }

  let isServerOnline = false
  let hasStartupRoutineRun = false
  let hasShutdownRoutineRun = false

  server.ext('onPreStop', async function (request, h) {
    if (!hasShutdownRoutineRun) {
      hasShutdownRoutineRun = true
      if (config.showDebug) {
        console.log('Hapi PreStop and Shutdown Routine')
      }

      await config.shutdownRoutine()
    }
  })

  server.ext('onPreStart', async function (request, h) {
    if (!hasStartupRoutineRun) {
      hasStartupRoutineRun = true
      if (config.showDebug) {
        console.log('Hapi PreStart and Startup Routine')
      }

      await config.startupRoutine()
    }
  })

  server.ext('onPostStart', function (request, h) {
    isServerOnline = true
    if (config.showDebug) {
      console.log('Hapi PostStart and Hapi is Online')
    }
  })

  server.route({
    method: ['GET', 'OPTIONS'],
    path: config.livenessProbeEndpoint,
    handler(request, h) {
      if (!isServerOnline) {
        return h.response(`starting up`).type('text/plain').code(502)
      }

      return h.response(`online`).type('text/plain').code(200)
    },
  })

  server.route({
    method: ['GET', 'OPTIONS'],
    path: config.heartbeatProbeEndpoint,
    handler(request, h) {
      return h.response(`online`).type('text/plain').code(200)
    },
  })

  server.route({
    method: ['GET', 'OPTIONS'],
    path: config.readinessProbeEndpoint,
    handler(request, h) {
      if (process.env.IS_SHUTDOWN_REQUESTED === 'true') {
        return h.response(`failed`).type('text/plain').code(500)
      }

      return h.response(`online`).type('text/plain').code(200)
    },
  })

  if (config.showDebug) {
    server.route({
      method: ['GET', 'OPTIONS'],
      path: '/shutdownTest',
      handler(request, h) {
        console.log('Shutdown Requested')
        process.env.IS_SHUTDOWN_REQUESTED = 'true'
        return h.response(`shutting down`).type('text/plain').code(500)
      },
    })
  }

  try {
    process.on('SIGTERM', async () => {
      process.env.IS_SHUTDOWN_REQUESTED = 'true'
      await server.stop({ timeout: config.shutdownTimeout })

      setTimeout(() => {
        server.log('info', 'Waiting 3 last seconds')
        process.exit(1)
      }, 3000)
    })

    process.on('SIGINT', () => {
      process.env.IS_SHUTDOWN_REQUESTED = 'true'
      shutdownSystem('SIGINT', 'primary')
    })

    process.on('SIGUSR2', (err) => {
      shutdownSystem(err, 'SIGUSR2')
    })

    process.on('SIGUSR1', (err) => {
      shutdownSystem(err, 'SIGUSR1')
    })

    process.on('unhandledRejection', (err) => {
      if (config.restartHapiOnUnhandledError) {
        shutdownSystem(err, 'unhandledRejection')
      }
    })

    process.on('uncaughtException', (err) => {
      if (config.restartHapiOnUnhandledError) {
        shutdownSystem(err, 'uncaughtException')
      }
    })

    process.on('SIGHUP', (err) => {
      shutdownSystem(err, 'nodemon')
    })
  } catch (err) {
    shutdownSystem(err, 'Unhandled Plugin Error')
  }

  const shutdownSystem = async function (err, location) {
    if (config.showDebug) {
      console.error('Plugin Error', location, err)
    }

    process.env.IS_SHUTDOWN_REQUESTED = 'true'

    await server.stop({ timeout: config.shutdownTimeout })

    setTimeout(() => {
      server.log('info', 'Waiting 3 last seconds')
      process.exit(1)
    }, 3000)
  }
}

exports.name = 'hapi-on-kubernetes'

exports.pkg = require('../package.json')
