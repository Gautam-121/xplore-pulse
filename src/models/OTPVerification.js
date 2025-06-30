module.exports = (sequelize, Sequelize) => {
    const OTPVerification = sequelize.define('OTPVerification', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        phoneNumber: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        countryCode: {
          type: Sequelize.STRING(5),
          allowNull: false,
        },
        // OTP details
        otpCode: {
          type: Sequelize.STRING(10),
          allowNull: false,
        },
        otpHash: {
          type: Sequelize.STRING(256),
          allowNull: false,
        },
        otpType: {
          type: Sequelize.ENUM('SIGNUP', 'LOGIN', 'VERIFICATION', 'PASSWORD_RESET'),
          allowNull: false,
        },
        // Verification status
        isVerified: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        verificationAttempts: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        maxAttempts: {
          type: Sequelize.INTEGER,
          defaultValue: 5,
        },
        // Timing
        expiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        verifiedAt: {
          type: Sequelize.DATE,
        },
        // Rate limiting
        ipAddress: {
          type: Sequelize.INET,
        },
        userAgent: {
          type: Sequelize.TEXT,
        }
      }, {
        indexes: [
          {
            fields: ['phoneNumber', 'countryCode']
          },
          {
            fields: ['expiresAt']
          }
        ]
      });
    
      return OTPVerification;
};