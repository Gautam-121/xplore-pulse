// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { ApolloServer } = require('@apollo/server');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { expressMiddleware } = require('@apollo/server/express4');
const { makeExecutableSchema } = require('@graphql-tools/schema');
// const { WebSocketServer } = require('ws');
// const { useServer } = require('graphql-ws/lib/use/ws');
const logger = require('./utils/logger');
const typeDefs = require('./schemas');
const resolvers = require('./resolvers');
const createContext = require('./middleware/context');
const createUserLoaders = require('./loaders/userLoaders');
// const authService = require('./services/authService');
const db = require('./config/dbConfig');
const { GraphQLError } = require('graphql');
const { ApolloServerErrorCode } = require('@apollo/server/errors');
const { testConnection } = require('./config/dbEnv');
const { MAX_FILES , MAX_FILE_SIZE} = require("./utils/constant")


// --- Global error handlers--- //
process.on('uncaughtException', (err) => {
  console.log("err" , err)
  logger.error('❌ Uncaught Exception:', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('❌ Unhandled Rejection:', { message: err.message, stack: err.stack });
  process.exit(1);
});
// --- End global error handlers --- //

const schema = makeExecutableSchema({ typeDefs, resolvers });
let httpServerGlobal = null;
let isShuttingDown = false;

async function startServer() {

  // Dynamically import graphql-upload components inside async function
  const { default: graphqlUploadExpress } = await import('graphql-upload/graphqlUploadExpress.mjs');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static("public"));
  app.use(cors());

  // It processes multipart/form-data requests for file uploads
  app.use(graphqlUploadExpress({ maxFileSize: MAX_FILE_SIZE, maxFiles: MAX_FILES }));

  // Health check route
  const healthRouter = require('./routes/health');
  app.use('/health', healthRouter);

  const httpServer = http.createServer(app);
  httpServerGlobal = httpServer;

  // --------- Subscriptions Setup  --------- //
  /*
  // WebSocket server for subscriptions
  const wsServer = new WebSocketServer({ server: httpServer, path: '/subscriptions' });

  // Save the returned server's cleanup for shutdown
  const serverCleanup = useServer({
    schema,
    context: async (ctx) => {
      const token = ctx.connectionParams?.authorization?.replace('Bearer ', '');
      const user = token ? await authService.validateToken(token) : null;
      return { user, loaders: createUserLoaders() };
    },
    onConnect: async () => logger.info('WebSocket connection established'),
    onDisconnect: async () => logger.info('WebSocket disconnected')
  }, wsServer);
  // ------- End Subscriptions Setup ------------
  */

  const server = new ApolloServer({
    schema,
    formatError: (formattedError, error) => {
      logger.error('GraphQL Error:', {
        message: formattedError.message,
        code: formattedError.extensions?.code,
        path: formattedError.path,
        stack: error?.stack,
      });

      // Mask internal server errors in production
      if (process.env.NODE_ENV === 'production' && formattedError.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        return new GraphQLError('Internal server error', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }

       // Custom message for validation errors
      if (formattedError.extensions?.code === ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED) {
        return {
          ...formattedError,
          message: "Your query doesn't match the schema. Please check your request.",
        };
      }

      return formattedError;
    },
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      // --- Subscription Shutdown Plugin ------
      // {
      //   async serverWillStart() {
      //     return {
      //       async drainServer() {
      //         await serverCleanup.dispose();
      //       },
      //     };
      //   },
      // },
      // --- End subscriptions shutdown plugin -----
    ],
  });

  await server.start();

  app.use(
    '/graphql',
    (req, res, next) => {
      req.body = req.body || {};
      next();
    },
    expressMiddleware(server, {
      context: async ({ req, res }) => {
        const context = await createContext({ req, res });
        context.loaders = createUserLoaders();
        return context;
      },
    })
  );

  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => {
    logger.info(`🚀 Server ready at http://localhost:${PORT}/graphql`);
    logger.info(`🚀 Subscriptions ready at ws://localhost:${PORT}/subscriptions)`);
  });
}

// Graceful shutdown
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('🔻 Gracefully shutting down...');

  try {
    if (httpServerGlobal) await new Promise((resolve) => httpServerGlobal.close(resolve));
    await db.sequelize.close();
    logger.info('✅ Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('❌ Error during shutdown:', { message: err.message, stack: err.stack });
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Connect DB and start server
(async () => {
  try {
    const isConnected = await testConnection(db.sequelize);
    if (!isConnected) throw new Error('❌ Database connection test failed');

    logger.info('✅ Models loaded:', {
      models: Object.keys(db).filter((key) => key !== 'Sequelize' && key !== 'sequelize')
    });

    await startServer();
  } catch (err) {
    logger.error('Failed to start server', {err});
    process.exit(1);
  }
})();
