module.exports = (sequelize, Sequelize) => {
    const PostLike = sequelize.define('PostLike', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
        // userId: {
        //     type: Sequelize.UUID,
        //     allowNull: false,
        //     references: {
        //         model: User,
        //         key: 'id'
        //     }
        // },
        // postId: {
        //     type: Sequelize.UUID,
        //     allowNull: false,
        //     references: {
        //         model: CommunityPost,
        //         key: 'id'
        //     }
        // }
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