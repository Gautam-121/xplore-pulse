module.exports = (sequelize, Sequelize) => {
    const CommunityPost = sequelize.define('CommunityPost', {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true
        },
        communityId: {
            type: Sequelize.UUID,
            allowNull: false
        },
        authorId: {
            type: Sequelize.UUID,
            allowNull: false
        },
        type: {
            type: Sequelize.ENUM('TEXT', 'IMAGE', 'VIDEO', 'LINK', 'POLL', 'EDUCATIONAL', 'QUIZ', 'MIXED'),
            allowNull: false
        },
        title: {
            type: Sequelize.STRING
        },
        content: {
            type: Sequelize.TEXT
        },
        media: {
            type: Sequelize.JSONB, // Array of { type, url, thumbnailUrl, duration, altText }
            defaultValue: []
        },
        quizzes: {
            type: Sequelize.JSONB, // Array of quiz definitions (id, question, options, correctOptionId)
            defaultValue: []
        },
        pollOptions: {
            type: Sequelize.JSONB, // Array of { id, text, voteCount }
            defaultValue: []
        },
        pollCount: {
            type: Sequelize.INTEGER,
            defaultValue: 0
        },
        // Link preview fields for LINK type posts
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
        tags: {
            type: Sequelize.ARRAY(Sequelize.STRING),
            defaultValue: []
        },
        visibility: {
            type: Sequelize.ENUM('PUBLIC', 'MEMBERS_ONLY', 'ADMINS_ONLY', 'PRIVATE'),
            defaultValue: 'PUBLIC'
        },
        isSponsored: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        // --- Poll/Quiz open/close fields ---
        pollOpen: {
            type: Sequelize.BOOLEAN,
            defaultValue: true
        },
        pollCloseAt: {
            type: Sequelize.DATE,
            allowNull: true
        },
        quizOpen: {
            type: Sequelize.BOOLEAN,
            defaultValue: true
        },
        quizCloseAt: {
            type: Sequelize.DATE,
            allowNull: true
        },
        createdAt: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        updatedAt: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        }
        // Mentions, reactions, pollVotes, quizResponses are handled in separate models for scalability
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['communityId', 'createdAt'] },
            { fields: ['authorId'] },
            { fields: ['type'] },
            { fields: ['visibility'] }
        ]
    });
    return CommunityPost
};