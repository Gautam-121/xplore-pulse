module.exports = (sequelize, Sequelize) => {
    const CommunityInterest = sequelize.define('CommunityInterest', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
        // communityId: {
        //     type: Sequelize.UUID,
        //     references: {
        //         model: Community,
        //         key: 'id'
        //     },
        //     primaryKey: true
        // },
        // interestId: {
        //     type: Sequelize.UUID,
        //     references: {
        //         model: Interest,
        //         key: 'id'
        //     },
        //     primaryKey: true
        // }
    }, {
        timestamps: true
    });
    return CommunityInterest
};