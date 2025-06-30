module.exports = (sequelize, Sequelize) => {
    const UserInterest = sequelize.define('UserInterest', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        priorityOrder: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        addedAt: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        }
      }, {
        indexes: [
          {
            unique: true,
            fields: ['userId', 'interestId']
          }
        ]
      });
    return UserInterest
};