module.exports = (sequelize, Sequelize) => {
    const PostLike = sequelize.define('PostLike', {
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
            },
            {
                fields: ['postId']
            }
        ]
    });
    return PostLike
};