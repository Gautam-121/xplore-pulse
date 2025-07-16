module.exports = (sequelize, Sequelize) => {
  const PostReaction = sequelize.define('PostReaction', {
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
    userId: {
      type: Sequelize.UUID,
      allowNull: false
    },
    type: {
      type: Sequelize.ENUM('LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'),
      allowNull: false
    }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['postId'] },
      { fields: ['userId'] },
      { fields: ['postId', 'type'] },
      { fields: ['postId', 'userId'], unique: true }
    ]
  });
  return PostReaction;
}; 