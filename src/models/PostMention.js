module.exports = (sequelize, Sequelize) => {
  const PostMention = sequelize.define('PostMention', {
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
    }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['postId'] },
      { fields: ['userId'] },
      { fields: ['postId', 'userId'], unique: true }
    ]
  });
  return PostMention;
}; 