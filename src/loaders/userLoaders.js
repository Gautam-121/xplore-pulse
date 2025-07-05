const DataLoader = require('dataloader');
const db = require("../config/dbConfig");
const User = db.User;
const Interest = db.Interest;
const UserInterest = db.UserInterest;
const logger = require('../utils/logger');

const createUserLoaders = () => {
  const userLoader = new DataLoader(async (userIds) => {
    logger.debug('userLoader: loading users with interests', { userIds });

    const users = await User.findAll({
      where: { id: userIds },
      include: [{
        model: Interest,
        as: 'interests',
        through: { attributes: [] }
      }]
    });

    logger.debug('userLoader: users fetched', {
      fetchedCount: users.length,
      fetchedUserIds: users.map(u => u.id)
    });

    // Create a map for quick lookup
    const userMap = users.reduce((map, user) => {
      map[user.id] = user;
      return map;
    }, {});

    // Return users in the same order as requested
    const result = userIds.map(id => userMap[id] || null);
    logger.debug('userLoader: result mapped to input order');
    return result;
  });

  const userInterestsLoader = new DataLoader(async (userIds) => {
    logger.debug('userInterestsLoader: loading interests for users', { userIds });

    const userInterests = await UserInterest.findAll({
      where: { userId: userIds },
      include: [{
        model: Interest,
        as: 'interest'
      }]
    });

    logger.debug('userInterestsLoader: userInterests fetched', {
      totalRecords: userInterests.length
    });

    // Group interests by user ID
    const interestsByUser = userInterests.reduce((map, ui) => {
      if (!map[ui.userId]) map[ui.userId] = [];
      map[ui.userId].push(ui.interest);
      return map;
    }, {});

    const result = userIds.map(id => interestsByUser[id] || []);
    logger.debug('userInterestsLoader: interests grouped and mapped to input order');
    return result;
  });

  return {
    userLoader,
    userInterestsLoader
  };
};

module.exports = createUserLoaders;
