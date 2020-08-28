exports.register = function (server, _config) {
  process.env.IS_SHUTDOWN_REQUESTED = 'false'

  const config = {
    restartHapiOnUnhandledError: false,
    shutdownTimeout: 60 * 1000,
    livenessProbeEndpoint: '/liveness',
    heartbeatProbeEndpoint: '/heartbeat',
    readinessProbeEndpoint: '/readiness',
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
      await config.shutdownRoutine()
    }

    return h.continue
  })

  server.ext('onPreStart', async function (request, h) {
    if (!hasStartupRoutineRun) {
      hasStartupRoutineRun = true
      await config.startupRoutine()
    }

    return h.continue
  })

  server.ext('onPostStart', function (request, h) {
    isServerOnline = true
    return h.continue
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

  try {
    process.on('SIGINT', async () => {
      process.env.IS_SHUTDOWN_REQUESTED = 'true'
      await server.stop({ timeout: config.shutdownTimeout })

      setTimeout(() => {
        server.log('info', 'Waiting 3 last seconds')
        process.exit(1)
      }, 3000)
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

    process.on('exit', (err) => {
      shutdownSystem(err, 'exit')
    })

    process.on('SIGHUP', (err) => {
      shutdownSystem(err, 'nodemon')
    })
  } catch (err) {
    shutdownSystem(err, 'Unhandled Plugin Error')
  }

  const shutdownSystem = function (err, location) {
    if (err) {
      console.error('Plugin Error', location, err)
    }

    process.exit(1)
  }
}

exports.name = 'hapi-on-kubernetes'

exports.pkg = require('../package.json')
