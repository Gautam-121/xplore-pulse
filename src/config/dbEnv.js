require("dotenv").config();
const logger = require("../utils/logger.js")
const isProduction = process.env.NODE_ENV === 'production';

const env = {
  database: process.env.DATABASE,
  username: process.env.DB_USERNAME,
  password: process.env.PASSWORD,
  host: process.env.HOST,
  dialect: process.env.DIALECT || 'postgres',
  port: parseInt(process.env.DB_PORT, 10),
  pool: {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE, 10) || 60000,
    idle: parseInt(process.env.DB_POOL_IDLE, 10) || 20000,
    evict: 1000,
    handleDisconnects: true
  },
  dialectOptions: {
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT, 10),
    idle_in_transaction_session_timeout: parseInt(process.env.DB_IDLE_TRANSACTION_TIMEOUT, 10),
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10),
    ssl: isProduction
      ? {
          require: true,
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZE === 'true'
        }
      : false
  },
  retry: {
    max: parseInt(process.env.DB_RETRY_MAX, 10) || 3,
    timeout: parseInt(process.env.DB_RETRY_TIMEOUT, 10) || 5000,
    match: [
      /Deadlock/i,
      /Timeout/i,
      /ConnectionError/i,
      /ConnectionRefused/i,
      /Connection terminated/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeConnectionTimedOutError/,
    ],
    max: 3,
    backoffBase: 1000,
    backoffExponent: 1.5
  },
  logging: (msg) => {
    if (!isProduction || process.env.DB_LOGGING === 'true') {
      logger.debug(`[Sequelize ${new Date().toISOString()}] ${msg}`);
    }
  },
  benchmark: !isProduction
};

const testConnection = async (sequelize) => {
  let retries = 0;
  const maxRetries = env.retry.max;

  while (retries < maxRetries) {
    try {
      await sequelize.authenticate();
      logger.info('✅ Database connection established successfully');
      await sequelize.query('SELECT 1');
      await sequelize.sync({ alter: true  });

      return true;
    } catch (error) {
      retries++;
      logger.error(`❌ Database connection attempt ${retries}/${maxRetries} failed`, { error });

      if (retries === maxRetries) {
        logger.error('❌ Maximum connection retries reached. Giving up.');
        return false;
      }

      const backoffTime = env.retry.backoffBase * Math.pow(env.retry.backoffExponent, retries - 1);
      logger.info(`Waiting ${backoffTime}ms before next retry...`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }

  return false;
};

const validateConfig = () => {
  const requiredVars = ['DATABASE', 'PASSWORD', 'HOST', 'DB_USERNAME'];
  const missing = requiredVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

const checkDatabaseHealth = async (sequelize) => {
  try {
    await sequelize.authenticate();
    return {
      service: 'PostgreSQL',
      status: 'healthy',
    };
  } catch (error) {
    return {
      service: 'PostgreSQL',
      status: 'unhealthy',
      error: error.message,
    };
  }
};

validateConfig();

module.exports = { env, testConnection , checkDatabaseHealth };
