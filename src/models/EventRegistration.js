module.exports = (sequelize, Sequelize) => {
    const EventRegistration = sequelize.define('EventRegistration', {
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
        // },
        // Registration data as JSONB
        registrationData: {
            type: Sequelize.JSONB,
            defaultValue: {}
        },
        paymentStatus: {
            type: Sequelize.ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'),
            defaultValue: 'PENDING'
        },
        paymentId: {
            type: Sequelize.STRING
        },
        ticketCode: {
            type: Sequelize.STRING
        },
        checkInStatus: {
            type: Sequelize.ENUM('NOT_CHECKED_IN', 'CHECKED_IN'),
            defaultValue: 'NOT_CHECKED_IN'
        },
        checkInAt: {
            type: Sequelize.DATE
        }
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
    return EventRegistration
};