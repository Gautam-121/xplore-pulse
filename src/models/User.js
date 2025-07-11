module.exports = (sequelize, Sequelize) => {
    const User = sequelize.define('User', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        phoneNumber: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        countryCode: {
          type: Sequelize.STRING(5),
          allowNull: true,
        },
        pendingPhoneNumber: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        pendingContryCode: {
          type: Sequelize.STRING(5),
          allowNull: true,
        },
        email: {
          type: Sequelize.STRING(255),
          allowNull: true,
          unique: true,
        },
        pendingEmail:{
          type: Sequelize.STRING(255),
          allowNull: true
        },
        googleId: {
          type: Sequelize.STRING,
          allowNull: true,
          unique: true
        },
        name: {
          type: Sequelize.STRING(100),
          validate: { len: [2, 100] }
        },
        bio: {
          type: Sequelize.TEXT,
          validate: { len: [0, 500] }
        },
        latitude:{
          type: Sequelize.FLOAT,
          allowNull: true
        },
        longitude:{
          type: Sequelize.FLOAT,
          allowNull: true
        },
        profileImageUrl: {
          type: Sequelize.TEXT,
        },
        isPhoneVerified: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        isEmailVerified: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        isSuspended: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        suspensionReason: {
          type: Sequelize.TEXT,
        },
        isProfileComplete: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        role: {
          type: Sequelize.ENUM('USER', 'ADMIN', 'MODERATOR'),
          defaultValue: 'USER',
        },
        onboardingStep: {
          type: Sequelize.ENUM('PHONE_VERIFICATION', 'PROFILE_SETUP', 'INTERESTS_SELECTION', 'COMMUNITY_RECOMMENDATIONS', 'COMPLETED'),
          defaultValue: 'PHONE_VERIFICATION',
        },
        onboardingCompletedAt: {
          type: Sequelize.DATE,
        },
        showOnlineStatus: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        ownedCommunitiesCount: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        joinedCommunitiesCount: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // Notification settings
        pushNotificationsEnabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        emailNotificationsEnabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        communityUpdatesEnabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        eventRemindersEnabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        lastActiveAt: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        deletedAt: {
          type: Sequelize.DATE,
        }
      }, {
        indexes: [
          {
            unique: true,
            fields: ['phoneNumber', 'countryCode']
          },
          {
            fields: ['email']
          },
          {
            fields: ['isActive', 'deletedAt']
          }
        ],
        scopes: {
          active: {
            where: { isActive: true }
          },
          verified: {
            where: { isPhoneVerified: true }
          }
        }
      });
    
      // Instance methods
      User.prototype.getFullName = function() {
        return this.name || `User ${this.phoneNumber}`;
      };
    
      User.prototype.getPublicProfile = function() {
        const publicFields = ['id', 'name', 'bio', 'profileImageUrl', 'isPhoneVerified', 'isEmailVerified', 'followersCount', 'followingCount', 'createdAt', 'role'];
        const profile = {};
        publicFields.forEach(field => {
          profile[field] = this[field];
        });
        // Add location as { latitude, longitude }
        if (this.location && this.location.coordinates) {
          profile.location = {
            latitude: this.location.coordinates[1],
            longitude: this.location.coordinates[0]
          };
        } else {
          profile.location = null;
        }
        return profile;
      };
    
      User.prototype.updateLastActive = async function() {
        this.lastActiveAt = new Date();
        await this.save({ fields: ['lastActiveAt'] });
      };
    
      return User;
};