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
db.Community = require('../models/Community.js')(sequelize, Sequelize);
db.UserCommunity = require('../models/UserCommunity.js')(sequelize, Sequelize);
db.PaymentSession = require('../models/PaymentSession.js')(sequelize, Sequelize);
db.CommunityInterest = sequelize.define('CommunityInterest', {}, { timestamps: false });

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

// User → created communities
db.User.hasMany(db.Community, {
  foreignKey: 'createdBy',
  as: 'createdCommunities'
});
db.Community.belongsTo(db.User, {
  foreignKey: 'createdBy',
  as: 'creator'
});


// User ↔ Community (joined)
db.User.belongsToMany(db.Community, {
  through: db.UserCommunity,
  foreignKey: 'userId',
  otherKey: 'communityId',
  as: 'joinedCommunities'
});
db.Community.belongsToMany(db.User, {
  through: db.UserCommunity,
  foreignKey: 'communityId',
  otherKey: 'userId',
  as: 'members'
});
db.UserCommunity.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});
db.UserCommunity.belongsTo(db.Community, {
  foreignKey: 'communityId',
  as: 'community'
});
db.User.hasMany(db.UserCommunity, {
  foreignKey: 'userId',
  as: 'memberships'
});
db.Community.hasMany(db.UserCommunity, {
  foreignKey: 'communityId',
  as: 'userMemberships'
});

// Community ↔ Interest
db.Community.belongsToMany(db.Interest, {
  through: db.CommunityInterest,
  foreignKey: 'communityId',
  otherKey: 'interestId',
  as: 'interests'
});
db.Interest.belongsToMany(db.Community, {
  through: db.CommunityInterest,
  foreignKey: 'interestId',
  otherKey: 'communityId',
  as: 'communities'
});

// User → PaymentSession
db.User.hasMany(db.PaymentSession, {
  foreignKey: 'userId',
  as: 'paymentSessions'
});
db.PaymentSession.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});

// Community → PaymentSession
db.Community.hasMany(db.PaymentSession, {
  foreignKey: 'communityId',
  as: 'paymentSessions'
});
db.PaymentSession.belongsTo(db.Community, {
  foreignKey: 'communityId',
  as: 'community'
});

module.exports = db;
