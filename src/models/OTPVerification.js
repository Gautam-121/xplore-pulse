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
        // OTP details - keeping for backward compatibility and fallback
        otpCode: {
          type: Sequelize.STRING(10),
          allowNull: true, // Made nullable since Kaleyra generates OTP
        },
        otpHash: {
          type: Sequelize.STRING(256),
          allowNull: true, // Made nullable since we're using Kaleyra verification
        },
        otpType: {
          type: Sequelize.ENUM('PHONE_AUTH','POST_GOOGLE_VERIFY'),
          allowNull: false,
        },
        // Kaleyra specific fields
        verifyId: {
          type: Sequelize.STRING(255),
          allowNull: true, // The verify_id returned by Kaleyra
          unique: true
        },
        provider: {
          type: Sequelize.ENUM('KALEYRA', 'TWILIO', 'MANUAL'),
          defaultValue: 'KALEYRA',
          allowNull: false
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
          defaultValue: 5, // Note: Kaleyra has its own attempt limits
        },
        // Timing
        expiresAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        verifiedAt: {
          type: Sequelize.DATE,
        },
        // Rate limiting and tracking
        ipAddress: {
          type: Sequelize.INET,
        },
        userAgent: {
          type: Sequelize.TEXT,
        },
        // Additional Kaleyra response data
        providerResponse: {
          type: Sequelize.JSONB, // Store additional response data from Kaleyra
          allowNull: true
        },
        // Status tracking
        providerStatus: {
          type: Sequelize.STRING(50), // Store status from Kaleyra (e.g., 'pending', 'approved', 'failed')
          allowNull: true
        }
      }, {
        indexes: [
          {
            fields: ['phoneNumber', 'countryCode']
          },
          {
            fields: ['expiresAt']
          },
          {
            fields: ['verifyId'], // Index for Kaleyra verify_id
            unique: true,
            where: {
              verifyId: {
                [Sequelize.Op.ne]: null
              }
            }
          },
          {
            fields: ['provider', 'otpType']
          }
        ]
      });
    
      return OTPVerification;
};