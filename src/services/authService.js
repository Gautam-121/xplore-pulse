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
        include: [{//
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

  /**
   * Revokes all sessions for a user (logout everywhere)
   */
  async revokeAllUserSessions(userId) {
    logger.debug('AuthService: Revoking all sessions for user', { userId });
    try {
      const result = await AuthSession.update(
        { isActive: false },
        { where: { userId } }
      );
      logger.info('AuthService: Revoked all sessions for user', { userId });
      return result;
    } catch (error) {
      logger.error('AuthService: Failed to revoke sessions for user', { userId, error });
      throw new GraphQLError('Failed to revoke user sessions', { extensions: { code: 'SESSION_REVOKE_FAILED' } });
    }
  }

  /**
   * Returns all active sessions for a user
   */
  async getUserActiveSessions(userId) {
    logger.debug('AuthService: Fetching active sessions for user', { userId });
    try {
      const sessions = await AuthSession.findAll({
        where: {
          userId,
          isActive: true,
          tokenExpiresAt: { [Op.gt]: new Date() }
        },
        order: [['lastUsedAt', 'DESC']]
      });
      logger.info('AuthService: Found active sessions for user', { count: sessions.length, userId });
      return sessions;
    } catch (error) {
      logger.error('AuthService: Failed to fetch active sessions for user', { userId, error });
      throw new GraphQLError('Failed to fetch user sessions', { extensions: { code: 'SESSION_FETCH_FAILED' } });
    }
  }
}

module.exports = new AuthService();
