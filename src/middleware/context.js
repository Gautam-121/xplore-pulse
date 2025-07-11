const authService = require('../services/authService');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const db = require('../config/dbConfig');
const User = db.User;
const createUserLoaders = require('../loaders/userLoaders');

/**
 * GraphQL context middleware
 * - Validates session or phone verification token
 * - Extracts user context and metadata (IP, user-agent, etc.)
 * - Initializes DataLoaders for performance optimization
 */
const createContext = async ({ req, res }) => {
  let session = null;
  let phoneVerificationUser = null;

  const token = req.headers.authorization?.replace('Bearer ', '');

  // Extract IP address and user agent safely
  const ipAddress =
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.connection?.socket?.remoteAddress ||
    null;

  const userAgent = req.headers['user-agent'];

  try {
    if (token) {
      logger.debug('Authorization token received', {
        tokenPreview: token.substring(0, 10) + '...'
      });

      // Attempt standard session validation
      try {
        session = await authService.validateToken(token);

        if (session?.user) {
          logger.debug('Standard session token validated successfully', {
            userId: session.user.id
          });
        }
      } catch (sessionErr) {
        logger.warn('Standard session token validation failed', {
          error: sessionErr.message
        });
      }

      // If session fails, try verifying phone_verification token
      if (!session) {
        try {
          const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

          if (decoded?.type === 'phone_verification' && decoded.userId) {
            let userRecord = null;

            try {
              userRecord = await User.findByPk(decoded.userId);
            } catch (dbErr) {
              logger.error('Failed to fetch user from DB for phone verification', {
                userId: decoded.userId,
                error: dbErr.message
              });
            }

            phoneVerificationUser = {
              id: decoded.userId,
              onboardingStep: 'PHONE_VERIFICATION',
              isActive: userRecord?.isActive || false
            };

            logger.debug('Phone verification token accepted', {
              userId: phoneVerificationUser.id,
              isActive: phoneVerificationUser.isActive
            });
          } else {
            logger.warn('Decoded token is not of type phone_verification');
          }
        } catch (jwtErr) {
          logger.warn('JWT verification failed', {
            error: jwtErr.message,
            tokenPreview: token.substring(0, 10) + '...'
          });
        }
      }
    } else {
      logger.debug('No authorization token found in request headers');
    }
  } catch (err) {
    logger.error('Error while building GraphQL context', {
      error: err.message,
      stack: err.stack
    });
  }

  // Initialize DataLoaders for this request
  const loaders = createUserLoaders();

  logger.debug('GraphQL request context created', {
    userId: session?.user?.id || phoneVerificationUser?.id || null,
    path: req.path,
    method: req.method,
    ipAddressPreview: ipAddress?.substring(0, 15) + '...'
  });

  return {
    user: session?.user || phoneVerificationUser || null,
    deviceId: session?.deviceId || null,
    ipAddress,
    userAgent,
    req,
    res,
    loaders, // Add DataLoaders to context
    dataSources: {
      // Add your data loaders here
    }
  };
};

module.exports = createContext;
