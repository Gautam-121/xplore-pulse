module.exports = (sequelize, Sequelize) => {
    const CommunityPost = sequelize.define('CommunityPost', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
        type: {
            type: Sequelize.ENUM('TEXT', 'IMAGE', 'VIDEO', 'LINK', 'EVENT', 'EDUCATIONAL', 'POLL'),
            allowNull: false
        },
        title: {
            type: Sequelize.STRING,
            allowNull: false
        },
        content: {
            type: Sequelize.TEXT
        },
        imageUrls: {
            type: Sequelize.ARRAY(Sequelize.TEXT),
            defaultValue: []
        },
        videoUrl: {
            type: Sequelize.TEXT
        },
        linkUrl: {
            type: Sequelize.TEXT
        },
        linkTitle: {
            type: Sequelize.STRING
        },
        linkDescription: {
            type: Sequelize.TEXT
        },
        linkImageUrl: {
            type: Sequelize.TEXT
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
        likesCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        commentsCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        sharesCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        viewsCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        // Event details as JSONB
        eventDetails: {
            type: Sequelize.JSONB,
            defaultValue: {}
        },
        tags: {
            type: Sequelize.ARRAY(Sequelize.STRING),
            defaultValue: []
        },
        isApproved: {
            type: Sequelize.BOOLEAN,
            defaultValue: true
        },
        approvedAt: {
            type: Sequelize.DATE
        },
        isArchived: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        }
    }, {
        timestamps: true,
        indexes: [
            {
                fields: ['communityId', 'createdAt']
            },
            {
                fields: ['authorId']
            },
            {
                fields: ['type']
            },
            {
                fields: ['isPaid']
            },
            {
                name: 'idx_community_post_tags_gin',
                using: 'gin',
                fields: ['tags']
            }
        ]
    });
    return CommunityPost
};