module.exports = (sequelize, Sequelize) => {
    const Community = sequelize.define('Community', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
        name: {
            type: Sequelize.STRING,
            allowNull: false
        },
        slug: {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true
        },
        description: {
            type: Sequelize.TEXT,
            allowNull: false
        },
        imageUrl: {
            type: Sequelize.TEXT
        },
        coverImageUrl: {
            type: Sequelize.TEXT
        },
        isPrivate: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        isPaid: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        price: {
            type: Sequelize.DECIMAL(10, 2)
        },
        currency: {
            type: Sequelize.STRING(3),
            defaultValue: 'USD'
        },
        memberCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        postCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        eventCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        latitude:{
            type: Sequelize.FLOAT,
            allowNull: false
        },
        longitude:{
            type: Sequelize.FLOAT,
            allowNull: false
        },
        // Settings as JSONB
        settings: {
            type: Sequelize.JSONB,
            defaultValue: {
                allowMemberPosts: true,
                allowMemberEvents: true,
                requirePostApproval: false,
                allowMemberInvites: true
            }
        },
        // Stats as JSONB
        stats: {
            type: Sequelize.JSONB,
            defaultValue: {
                weeklyActiveMembers: 0,
                monthlyActiveMembers: 0,
                totalEngagement: 0
            }
        },
        lastActivityAt: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        }
    }, {
        timestamps: true,
        indexes: [
            // For efficient filtering by ownerId + pagination
            {
              name: 'idx_community_owner_createdAt',
              fields: ['ownerId', 'createdAt']
            },
            // Used for quick filtering/sorting
            {
              name: 'idx_community_visibility_payment',
              fields: ['isPrivate', 'isPaid']
            },
            {
              name: 'idx_community_memberCount',
              fields: ['memberCount']
            },
            {
              name: 'idx_community_lastActivity',
              fields: ['lastActivityAt']
            },
            {
              name: 'idx_community_slug',
              unique: true,
              fields: ['slug']
            }
        ]
    });
    return Community
};











