const { env } = require("./dbEnv.js");
const pg = require("pg");
const Sequelize = require("sequelize");
const logger = require('../utils/logger.js');

let sequelize = null;

try {
  sequelize = new Sequelize(env.database, env.username, env.password, {
    host: env.host,
    port: env.port,
    dialect: env.dialect,
    dialectModule: pg,
    pool: {
      max: env.pool.max,
      min: env.pool.min,
      acquire: env.pool.acquire,
      idle: env.pool.idle,
    },
    retry: env.retry,
    dialectOptions: env.dialectOptions,
    logging: false,
    benchmark: env.benchmark
  });
} catch (error) {
  logger.error("Error creating Sequelize instance", { error });
  process.exit(1);
}

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.User = require("../models/User.js")(sequelize, Sequelize)
db.AuthSession = require("../models/AuthSession.js")(sequelize, Sequelize)
db.OtpVerification = require("../models/OTPVerification.js")(sequelize, Sequelize)
db.Interest = require("../models/Interest.js")(sequelize, Sequelize)
db.UserInterest = require("../models/UserInterest.js")(sequelize, Sequelize)


// User → AuthSession
db.User.hasMany(db.AuthSession, { foreignKey: 'userId', as: 'sessions' ,  } );
db.AuthSession.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

// User ↔ Interest
db.User.belongsToMany(db.Interest, {
  through: db.UserInterest,
  foreignKey: 'userId',
  otherKey: 'interestId',
  as: 'interests'
});
db.Interest.belongsToMany(db.User, {
  through: db.UserInterest,
  foreignKey: 'interestId',
  otherKey: 'userId',
  as: 'users'
});
db.UserInterest.belongsTo(db.Interest, { foreignKey: 'interestId', as: 'interest' });


module.exports = db;
