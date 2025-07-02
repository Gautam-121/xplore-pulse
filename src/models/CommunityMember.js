module.exports = (sequelize, Sequelize) => {
    const CommunityMember = sequelize.define('CommunityMember',
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            userId: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: User,
                    key: 'id'
                }
            },
            communityId: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: Community,
                    key: 'id'
                }
            },
            role: {
                type: DataTypes.ENUM('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'),
                defaultValue: 'MEMBER'
            },
            status: {
                type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'BANNED'),
                defaultValue: 'PENDING'
            },
            requestedAt: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            joinedAt: {
                type: DataTypes.DATE
            },
            lastActiveAt: {
                type: DataTypes.DATE
            },
            invitedBy: {
                type: DataTypes.UUID,
                references: {
                    model: User,
                    key: 'id'
                }
            },
            banReason: {
                type: DataTypes.TEXT
            },
            bannedAt: {
                type: DataTypes.DATE
            },
            bannedBy: {
                type: DataTypes.UUID,
                references: {
                    model: User,
                    key: 'id'
                }
            }
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