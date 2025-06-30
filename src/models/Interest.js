const { POPULARITY_THRESHOLD} = require("../utils/constant")
module.exports = (sequelize, Sequelize) => {
    const Interest = sequelize.define('Interest', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        name: {
          type: Sequelize.STRING(100),
          allowNull: false,
          unique: true
        },
        slug: {
          type: Sequelize.STRING(100),
          allowNull: false,
          unique: true
        },
        description: Sequelize.TEXT,
        iconUrl: {
          type: Sequelize.TEXT,
        },
        colorHex: {
          type: Sequelize.STRING(7),
          validate: { is: /^#[0-9A-F]{6}$/i }
        },
        category: {
          type: Sequelize.ENUM(
            'TECHNOLOGY', 'TRAVEL', 'SCIENCE', 'HEALTH_FITNESS', 'BUSINESS',
            'ARTS_CULTURE', 'FOOD_DRINK', 'SPORTS', 'EDUCATION', 'LIFESTYLE',
            'MUSIC', 'GAMING', 'FASHION', 'PHOTOGRAPHY'
          ),
          allowNull: false
        },
        // Popularity metrics
        isPopular: {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
        },
        followersCount: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        sortOrder: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        // Status
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        }
      }, {
        hooks: {
          beforeCreate: (interest) => {
            interest.isPopular = interest.followersCount >= POPULARITY_THRESHOLD;
          },
          beforeUpdate: (interest) => {
            if (interest.changed('followersCount')) {
              interest.isPopular = interest.followersCount >= POPULARITY_THRESHOLD;
            }
          }
        },
        indexes: [
          {
            fields: ['category', 'isActive']
          },
          {
            fields: ['isPopular', 'followersCount']
          },
          {
            fields: ['slug']
          }
        ]
      });
    
      return Interest;
}