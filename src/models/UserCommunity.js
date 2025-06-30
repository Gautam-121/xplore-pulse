module.exports = (sequelize, Sequelize) => {
    const UserCommunity = sequelize.define('UserCommunity', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      role: {
        type: Sequelize.ENUM('MEMBER', 'MODERATOR', 'ADMIN', 'OWNER'),
        defaultValue: 'MEMBER',
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'LEFT', 'BANNED', 'SUSPENDED', 'PENDING'),
        defaultValue: 'ACTIVE',
        allowNull: false
      },
      joinedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      joinMethod: {
        type: Sequelize.ENUM('DIRECT', 'INVITE', 'RECOMMENDATION', 'SEARCH'),
        defaultValue: 'DIRECT'
      },
      paymentStatus: {
        type: Sequelize.ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'),
        allowNull: true
      },
      paymentSessionId: {
        type: Sequelize.STRING,
        allowNull: true
      },
      transactionId: {
        type: Sequelize.STRING,
        allowNull: true
      },
      amountPaid: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00
      },
      subscriptionExpiresAt: {
        type: Sequelize.DATE,
        allowNull: true
      }
    }, {
      indexes: [
        { unique: true, fields: ['userId', 'communityId'] },
        { fields: ['status'] },
        { fields: ['role'] },
        { fields: ['paymentStatus'] }
      ],
      scopes: {
        active: { where: { status: 'ACTIVE' } },
        admins: {
          where: {
            role: ['ADMIN', 'OWNER'],
            status: 'ACTIVE'
          }
        }
      }
    });
  
    // Instance methods
    UserCommunity.prototype.isAdmin = function () {
      return ['ADMIN', 'OWNER'].includes(this.role) && this.status === 'ACTIVE';
    };
  
    return UserCommunity;
  };
  