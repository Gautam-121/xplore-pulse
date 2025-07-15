module.exports = (sequelize, Sequelize) => {
    const PostBookmark = sequelize.define('PostBookmark', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
  
      }, {
        timestamps: true,
        indexes: [
          {
            unique: true,
            fields: ['userId', 'postId']
          }
        ]
      });
    return PostBookmark
};