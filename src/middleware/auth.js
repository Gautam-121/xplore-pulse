const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

const requireAuth = (resolver) => {
  return (parent, args, context, info) => {
    if (!context.user) {
      logger.warn('Authentication failed: no user in context', {
        operation: info.operation?.operation,
        fieldName: info.fieldName,
        path: info.path?.key
      });
      throw new GraphQLError('You must be logged in to perform this action', { extensions: { code: 'UNAUTHENTICATED' } });
    }

    if (!context.user.isActive) {
      logger.warn('Authorization failed: user account is inactive', {
        userId: context.user.id,
        fieldName: info.fieldName
      });
      throw new GraphQLError('Your account is not active', { extensions: { code: 'FORBIDDEN' } });
    }

    logger.debug('Active user check passed', {
      userId: context.user.id,
      fieldName: info.fieldName
    });

    logger.debug('Authentication passed', {
      userId: context.user.id,
      fieldName: info.fieldName
    });

    return resolver(parent, args, context, info);
  };
};

const requireActiveUser = (resolver) => {
  return (parent, args, context, info) => {
    if (!context.user) {
      logger.warn('Authentication failed: no user in context', {
        operation: info.operation?.operation,
        fieldName: info.fieldName,
        path: info.path?.key
      });
      throw new GraphQLError('You must be logged in to perform this action', { extensions: { code: 'UNAUTHENTICATED' } });
    }

    if (!context.user.isActive) {
      logger.warn('Authorization failed: user account is inactive', {
        userId: context.user.id,
        fieldName: info.fieldName
      });
      throw new GraphQLError('Your account is not active', { extensions: { code: 'FORBIDDEN' } });
    }

    logger.debug('Active user check passed', {
      userId: context.user.id,
      fieldName: info.fieldName
    });

    return resolver(parent, args, context, info);
  };
};

const requireRole = (roles) => (resolver) => {
  return (parent, args, context, info) => {
    if (!context.user) {
      logger.warn('Authorization failed: no user in context', {
        operation: info.operation?.operation,
        fieldName: info.fieldName,
        path: info.path?.key
      });
      throw new GraphQLError('You must be logged in to perform this action', { extensions: { code: 'UNAUTHENTICATED' } });
    }
    if (!roles.includes(context.user.role)) {
      logger.warn('Authorization failed: insufficient role', {
        userId: context.user.id,
        userRole: context.user.role,
        requiredRoles: roles,
        fieldName: info.fieldName
      });
      throw new GraphQLError('You do not have permission to perform this action', { extensions: { code: 'FORBIDDEN' } });
    }
    logger.debug('Role check passed', {
      userId: context.user.id,
      userRole: context.user.role,
      fieldName: info.fieldName
    });
    return resolver(parent, args, context, info);
  };
};

module.exports = {
  requireAuth,
  requireActiveUser,
  requireRole
};
