module.exports = (sequelize, Sequelize) => {
    const CommunityInterest = sequelize.define('CommunityInterest', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
    }, {
        timestamps: true,
        indexes: [
            { fields: ['communityId', 'interestId'] },
            { fields: ['interestId', 'communityId'] }
        ]
    });
    return CommunityInterest
};