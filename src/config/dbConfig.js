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
db.Community = require("../models/Community.js")(sequelize , Sequelize)
db.CommunityMember = require("../models/CommunityMember.js")(sequelize , Sequelize)
db.CommunityInterest = require("../models/CommunityInterest.js")(sequelize , Sequelize)
db.CommunityPost = require("../models/CommunityPost.js")(sequelize , Sequelize)
db.EventRegistration = require("../models/EventRegistration.js")(sequelize , Sequelize)
db.PostBookmark = require("../models/PostBookmark.js")(sequelize , Sequelize)
db.PostLike = require("../models/PostLike.js")(sequelize , Sequelize)


// User → AuthSession
db.User.hasMany(db.AuthSession, { foreignKey: 'userId', as: 'sessions', });
db.AuthSession.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

// User hasMany OTPVerification
db.User.hasMany(db.OtpVerification, {
  foreignKey: { name: "userId", allowNull: true },
  as: "otpVerifications",
  allowNull: true,
});
db.OtpVerification.belongsTo(db.User, {
   foreignKey: { name: "userId", allowNull: true }, 
   as: 'user' 
});

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


db.User.hasMany(db.Community, { 
  foreignKey: 'ownerId',
  as: 'ownedCommunities'
});

db.User.belongsToMany(db.Community, {
  through: db.CommunityMember,
  foreignKey: 'userId',
  otherKey: 'communityId',
  as: 'joinedCommunities'
});

db.User.hasMany(db.CommunityPost, {
  foreignKey: 'authorId',
  as: 'posts'
});

db.User.hasMany(db.PostLike, {
  foreignKey: 'userId',
  as: 'likedPosts'
});

db.User.hasMany(db.PostBookmark, {
  foreignKey: 'userId',
  as: 'bookmarkedPosts'
});

db.User.hasMany(db.EventRegistration, {
  foreignKey: 'userId',
  as: 'eventRegistrations'
});


db.Interest.belongsToMany(db.Community, {
  through: db.CommunityInterest,
  foreignKey: 'interestId',
  otherKey: 'communityId',
  as: 'communities'
});

// Community associations
db.Community.belongsTo(db.User, {
  foreignKey: 'ownerId',
  as: 'owner'
});

db.Community.belongsToMany(db.Interest, {
  through: db.CommunityInterest,
  foreignKey: 'communityId',
  otherKey: 'interestId',
  as: 'interests'
});

db.Community.belongsToMany(db.User, {
  through: db.CommunityMember,
  foreignKey: 'communityId',
  otherKey: 'userId',
  as: 'members'
});

db.Community.hasMany(db.CommunityPost, {
  foreignKey: 'communityId',
  as: 'posts'
});

db.Community.hasMany(db.CommunityMember, {
  foreignKey: 'communityId',
  as: 'memberships'
});

// CommunityMember associations
db.CommunityMember.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});

db.CommunityMember.belongsTo(db.Community, {
  foreignKey: 'communityId',
  as: 'community'
});

db.CommunityMember.belongsTo(db.User, {
  foreignKey: 'invitedBy',
  as: 'inviter'
});

db.CommunityMember.belongsTo(db.User, {
  foreignKey: 'bannedBy',
  as: 'banner'
});

// CommunityPost associations
db.CommunityPost.belongsTo(db.User, {
  foreignKey: 'authorId',
  as: 'author'
});

db.CommunityPost.belongsTo(db.Community, {
  foreignKey: 'communityId',
  as: 'community'
});

db.CommunityPost.belongsTo(db.User, {
  foreignKey: 'approvedBy',
  as: 'approver'
});

db.CommunityPost.hasMany(db.PostLike, {
  foreignKey: 'postId',
  as: 'likes'
});

db.CommunityPost.hasMany(db.PostBookmark, {
  foreignKey: 'postId',
  as: 'bookmarks'
});

db.CommunityPost.hasMany(db.EventRegistration, {
  foreignKey: 'postId',
  as: 'eventRegistrations'
});

// PostLike associations
db.PostLike.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});

db.PostLike.belongsTo(db.CommunityPost, {
  foreignKey: 'postId',
  as: 'post'
});

// PostBookmark associations
db.PostBookmark.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});

db.PostBookmark.belongsTo(db.CommunityPost, {
  foreignKey: 'postId',
  as: 'post'
});

// EventRegistration associations
db.EventRegistration.belongsTo(db.User, {
  foreignKey: 'userId',
  as: 'user'
});

db.EventRegistration.belongsTo(db.CommunityPost, {
  foreignKey: 'postId',
  as: 'post'
});


module.exports = db;
