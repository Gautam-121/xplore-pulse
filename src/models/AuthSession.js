module.exports = (sequelize, Sequelize) => {
    const AuthSession = sequelize.define('AuthSession', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        // Token management
        accessTokenHash: {
          type: Sequelize.STRING(256),
          allowNull: false,
        },
        refreshTokenHash: {
          type: Sequelize.STRING(256),
          allowNull: false,
        },
        tokenExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        refreshExpiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        // Device information
        deviceId: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        deviceType: {
          type: Sequelize.ENUM('iOS', 'Android', 'Web'),
          allowNull: false,
        },
        deviceName: {
          type: Sequelize.STRING(100),
        },
        appVersion: {
          type: Sequelize.STRING(20),
        },
        osVersion: {
          type: Sequelize.STRING(20),
        },
        fcmToken: {
          type: Sequelize.TEXT,
        },
        // Session tracking
        ipAddress: {
          type: Sequelize.INET,
        },
        userAgent: {
          type: Sequelize.TEXT,
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        lastUsedAt: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        }
      }, {
        indexes: [
          {
            unique: true,
            fields: ['userId', 'deviceId']
          },
          {
            fields: ['accessTokenHash']
          },
          {
            fields: ['refreshTokenHash']
          }
        ]
      });
    
      return AuthSession;
};

