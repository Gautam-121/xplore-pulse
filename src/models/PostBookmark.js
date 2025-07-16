module.exports = (sequelize, Sequelize) => {
    const PostBookmark = sequelize.define('PostBookmark', {
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
          { fields: ['userId', 'postId'], unique: true }
        ]
      });
    return PostBookmark;
};