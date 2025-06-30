module.exports = (sequelize, Sequelize) => {
    const Community = sequelize.define('Community', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        validate: { len: [3, 100] }
      },
      slug: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
        validate: { len: [10, 1000] }
      },
      shortDescription: {
        type: Sequelize.STRING(200),
        validate: { len: [10, 200] }
      },
      coverImageUrl: {
        type: Sequelize.TEXT,
      },
      logoUrl: {
        type: Sequelize.TEXT,
      },
      // Monetization
      type: {
        type: Sequelize.ENUM('FREE', 'PAID'),
        defaultValue: 'FREE'
      },
      isPaid: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      membershipFee: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        validate: { min: 0 }
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'USD',
        validate: { len: [3, 3] }
      },
      membershipType: {
        type: Sequelize.ENUM('ONE_TIME', 'MONTHLY', 'YEARLY'),
        defaultValue: 'ONE_TIME'
      },
      // Access & visibility
      privacy: {
        type: Sequelize.ENUM('PUBLIC', 'PRIVATE', 'SECRET'),
        defaultValue: 'PUBLIC'
      },
      joinApproval: {
        type: Sequelize.ENUM('AUTOMATIC', 'MANUAL', 'INVITE_ONLY'),
        defaultValue: 'AUTOMATIC'
      },
      // Membership & creator
      membersCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      // State flags
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      isArchived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      // Activity & cleanup
      lastActivityAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      deletedAt: {
        type: Sequelize.DATE,
      }
    }, {
      paranoid: true,
      hooks: {
        beforeCreate: (community) => {
          community.isPaid = community.membershipFee > 0;
  
          if (community.membershipFee > 0) {
            community.type = community.membershipFee >= 50 ? 'PREMIUM' : 'PAID';
          } else {
            community.type = 'FREE';
          }
        },
        beforeUpdate: (community) => {
          if (community.changed('membershipFee')) {
            community.isPaid = community.membershipFee > 0;
  
            if (community.membershipFee > 0) {
              community.type = community.membershipFee >= 50 ? 'PREMIUM' : 'PAID';
            } else {
              community.type = 'FREE';
            }
          }
  
          if (community.changed('membersCount')) {
            community.lastActivityAt = new Date();
          }
        }
      },
      indexes: [
        { fields: ['slug'] },
        { fields: ['type', 'isActive'] },
        { fields: ['privacy', 'isActive'] },
        { fields: ['createdBy'] },
        { fields: ['lastActivityAt'] }
      ]
    });
  
    Community.prototype.getPublicInfo = function () {
      const fields = [
        'id', 'name', 'slug', 'description', 'shortDescription',
        'coverImageUrl', 'logoUrl',
        'type', 'isPaid', 'membershipFee', 'currency', 'billingCycle',
        'privacy', 'membersCount', 'createdBy',
        'isActive', 'isArchived', 'createdAt', 'lastActivityAt'
      ];
  
      const info = {};
      fields.forEach(field => {
        info[field] = this[field];
      });
  
      return info;
    };
  
    return Community;
  };
  