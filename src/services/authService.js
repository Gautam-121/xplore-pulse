const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const db = require("../config/dbConfig")
const AuthSession = db.AuthSession
const User = db.User
const { Op } = require("sequelize")
const { GraphQLError } = require('graphql');

class AuthService {
  /**
   * Validates access token and returns user if session is valid
   */
  async validateToken(token) {
    logger.debug('AuthService: Validating token');
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      logger.debug('AuthService: Token decoded successfully', { userId: decoded.userId });

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const session = await AuthSession.findOne({
        where: {
          accessTokenHash: tokenHash,
          isActive: true,
          tokenExpiresAt: { [Op.gt]: new Date() }
        },
        include: [{
          model: User,
          as: 'user',
          where: { isActive: true }
        }]
      });

      if (!session) {
        logger.warn('AuthService: No active session found for token', { tokenHash });
        return null;
      }

      // Update session usage info
      await session.update({ lastUsedAt: new Date() });
      if (session.user && typeof session.user.updateLastActive === 'function') {
        await session.user.updateLastActive();
      }

      logger.info('AuthService: Token validated for user', { userId: session.user.id });
      return session;
    } catch (error) {
      logger.warn('AuthService: Token validation failed', { error: error.message });
      return null;
    }
  }
}

module.exports = new AuthService();
