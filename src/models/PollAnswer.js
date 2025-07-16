module.exports = (sequelize, Sequelize) => {
  const PollAnswer = sequelize.define('PollAnswer', {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true
    },
    postId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'CommunityPosts', key: 'id' }
    },
    optionId: {
      type: Sequelize.UUID,
      allowNull: false
    },
    userId: {
      type: Sequelize.UUID,
      allowNull: false
    },
    answeredAt: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW
    }
  }, {
    timestamps: false,
    indexes: [
      { fields: ['postId'] },
      { fields: ['optionId'] },
      { fields: ['userId'] },
      { fields: ['postId', 'optionId'] },
      { fields: ['postId', 'userId'], unique: true }
    ]
  });
  return PollAnswer;
}; 