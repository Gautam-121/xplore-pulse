module.exports = (sequelize, Sequelize) => {
    const CommunityMember = sequelize.define('CommunityMember',
        {
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
            // communityId: {
            //     type: Sequelize.UUID,
            //     allowNull: false,
            //     references: {
            //         model: Community,
            //         key: 'id'
            //     }
            // },
            role: {
                type: Sequelize.ENUM('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'),
                defaultValue: 'MEMBER'
            },
            status: {
                type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED', 'BANNED'),
                defaultValue: 'PENDING'
            },
            requestedAt: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW
            },
            joinedAt: {
                type: Sequelize.DATE
            },
            lastActiveAt: {
                type: Sequelize.DATE
            },
            // invitedBy: {
            //     type: Sequelize.UUID,
            //     references: {
            //         model: User,
            //         key: 'id'
            //     }
            // },
            banReason: {
                type: Sequelize.TEXT
            },
            bannedAt: {
                type: Sequelize.DATE
            },
            // bannedBy: {
            //     type: Sequelize.UUID,
            //     references: {
            //         model: User,
            //         key: 'id'
            //     }
            // }
        }, {
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['userId', 'communityId']
            },
            {
                fields: ['communityId', 'status']
            },
            {
                fields: ['userId', 'status']
            }
        ]
    });
    return CommunityMember
};