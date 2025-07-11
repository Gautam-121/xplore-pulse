const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

/**
 * Middleware to enforce user authentication.
 * Ensures that a user is logged in and active before accessing a GraphQL resolver.
 */
const requireAuth = (resolver) => {
  return (parent, args, context, info) => {
    const operation = info.operation?.operation;
    const fieldName = info.fieldName;
    const path = info.path?.key;

    // No user in context → not authenticated
    if (!context.user) {
      logger.warn('Authentication failed: No user found in context', {
        operation,
        fieldName,
        path,
      });

      throw new GraphQLError(
        'You must be logged in to perform this action.',
        { extensions: { code: 'UNAUTHENTICATED' } }
      );
    }

    // User is inactive → access denied
    if (!context.user.isActive) {
      logger.warn('Authorization failed: User account is inactive', {
        userId: context.user.id,
        fieldName,
      });

      throw new GraphQLError(
        'Your account is not active. Please contact support.',
        { extensions: { code: 'FORBIDDEN' } }
      );
    }

    // Passed all checks
    logger.debug('Authentication successful', {
      userId: context.user.id,
      email: context.user.email,
      fieldName,
    });

    return resolver(parent, args, context, info);
  };
};

/**
 * Middleware to enforce role-based access control.
 * Only users with specific roles can access the resolver.
 *
 * @param {Array<string>} roles - Allowed roles (e.g., ['ADMIN', 'MODERATOR'])
 */
const requireRole = (roles) => (resolver) => {
  return (parent, args, context, info) => {
    const operation = info.operation?.operation;
    const fieldName = info.fieldName;
    const path = info.path?.key;

    // No user in context → not authenticated
    if (!context.user) {
      logger.warn('Authorization failed: No user found in context', {
        operation,
        fieldName,
        path,
      });

      throw new GraphQLError(
        'You must be logged in to perform this action.',
        { extensions: { code: 'UNAUTHENTICATED' } }
      );
    }

    // User is inactive → access denied
    if (!context.user.isActive) {
      logger.warn('Authorization failed: User account is inactive', {
        userId: context.user.id,
        fieldName,
      });

      throw new GraphQLError(
        'Your account is not active. Please contact support.',
        { extensions: { code: 'FORBIDDEN' } }
      );
    }

    // User role does not match allowed roles → access denied
    if (!roles.includes(context.user.role)) {
      logger.warn('Authorization failed: Insufficient role', {
        userId: context.user.id,
        userRole: context.user.role,
        requiredRoles: roles,
        fieldName,
      });

      throw new GraphQLError(
        'You do not have permission to perform this action.',
        { extensions: { code: 'FORBIDDEN' } }
      );
    }

    // Passed role check
    logger.debug('Role authorization successful', {
      userId: context.user.id,
      userRole: context.user.role,
      allowedRoles: roles,
      fieldName,
    });

    return resolver(parent, args, context, info);
  };
};

module.exports = {
  requireAuth,
  requireRole,
};
