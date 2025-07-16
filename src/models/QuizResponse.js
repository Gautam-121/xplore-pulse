module.exports = (sequelize, Sequelize) => {
  const QuizResponse = sequelize.define('QuizResponse', {
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
    quizId: {
      type: Sequelize.UUID,
      allowNull: false
    },
    userId: {
      type: Sequelize.UUID,
      allowNull: false
    },
    optionId: {
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
      { fields: ['quizId'] },
      { fields: ['userId'] },
      { fields: ['postId', 'quizId', 'userId'], unique: true }
    ]
  });
  return QuizResponse;
}; 