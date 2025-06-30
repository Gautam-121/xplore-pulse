const authService = require('../services/authService');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');

const createContext = async ({ req, res }) => {
  let session = null;
  let phoneVerificationUser = null;
  const token = req.headers.authorization?.replace('Bearer ', '');

  // Extract IP address and user agent
  const ipAddress = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  if (token) {
    logger.debug('Authorization token received', {
      token: token.substring(0, 10) + '...' // Log partial token safely
    });

    try {
      // Try normal session token first
      session = await authService.validateToken(token);
      logger.debug('User successfully authenticated', {
        userId: session?.user?.id || null
      });
    } catch (error) {
      // If normal session fails, try phone_verification token
      try {
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        if (decoded && decoded.type === 'phone_verification' && decoded.userId) {
          phoneVerificationUser = { id: decoded.userId, onboardingStep: 'PHONE_VERIFICATION' };
          logger.debug('Phone verification token accepted', { userId: decoded.userId });
        } else {
          logger.warn('Token validation failed (not phone_verification)', {
            error: error.message,
            token: token.substring(0, 10) + '...'
          });
        }
      } catch (err2) {
        logger.warn('Token validation failed (all types)', {
          error: err2.message,
          token: token.substring(0, 10) + '...'
        });
      }
    }
  } else {
    logger.debug('No authorization token found in request headers');
  }

  logger.debug('GraphQL request context created', {
    userId: session?.user?.id || phoneVerificationUser?.id || null,
    path: req.path,
    method: req.method,
    ipAddress: ipAddress?.substring(0, 15) + '...' // Log partial IP safely
  });

  return {
    user: session?.user || phoneVerificationUser,
    deviceId: session?.deviceId,
    ipAddress,
    userAgent,
    req,
    res,
    dataSources: {
      // Add data loaders here
    }
  };
};

module.exports = createContext;
