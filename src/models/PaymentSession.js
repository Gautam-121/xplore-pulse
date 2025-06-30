module.exports = (sequelize, Sequelize) => {
    const PaymentSession = sequelize.define('PaymentSession', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
  
      // Associations
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
      },
      communityId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Communities', key: 'id' },
      },
      userCommunityId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'UserCommunities', key: 'id' },
      },
  
      // Identifiers
      sessionId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      orderId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
  
      // Payment details
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'USD',
      },
      status: {
        type: Sequelize.ENUM('CREATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED'),
        defaultValue: 'CREATED',
      },
  
      // PG info (minimal)
      gatewayProvider: {
        type: Sequelize.ENUM('RAZORPAY', 'STRIPE'),
        defaultValue: 'RAZORPAY',
      },
      gatewayPaymentId: {
        type: Sequelize.STRING,
      },
  
      // Timestamps
      completedAt: Sequelize.DATE,
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: () => {
          const expiry = new Date();
          expiry.setHours(expiry.getHours() + 1);
          return expiry;
        }
      },
  
      // Optional webhook status
      webhookReceived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      webhookData: {
        type: Sequelize.JSON,
      },
    }, {
      hooks: {
        beforeCreate: (session) => {
          if (!session.orderId) {
            const now = Date.now();
            const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
            session.orderId = `ORD_${now}_${rand}`;
          }
        },
        afterUpdate: async (session) => {
          if (session.changed('status') && session.status === 'COMPLETED') {
            if (session.userCommunityId) {
              await sequelize.models.UserCommunity.update({
                paymentStatus: 'COMPLETED',
                status: 'ACTIVE',
                paymentDate: new Date(),
              }, {
                where: { id: session.userCommunityId },
              });
            }
            session.completedAt = new Date();
            await session.save({ fields: ['completedAt'] });
          }
        }
      }
    });
  
    return PaymentSession;
  };
  