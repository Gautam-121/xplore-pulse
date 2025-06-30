const { EventEmitter } = require('events');

// In-memory event bus for demo (replace with Redis or other pubsub for production)
const pubsub = new EventEmitter();

const USER_STATUS_UPDATES = 'USER_STATUS_UPDATES';
const PROFILE_UPDATES = 'PROFILE_UPDATES';

const subscriptionResolvers = {
  Subscription: {
    userStatusUpdates: {
      // args: { userId }
      subscribe: async (_, { userId }) => {
        // Async iterator for user status updates
        const iterator = pubsub.asyncIterator
          ? pubsub.asyncIterator([`${USER_STATUS_UPDATES}:${userId}`])
          : async function* () {
              // Polyfill for asyncIterator if not present
              const handler = (payload) => iterator.push(payload);
              pubsub.on(`${USER_STATUS_UPDATES}:${userId}`, handler);
              try {
                while (true) {
                  yield await new Promise((resolve) => iterator.push = resolve);
                }
              } finally {
                pubsub.off(`${USER_STATUS_UPDATES}:${userId}`, handler);
              }
            }();
        return iterator;
      },
      resolve: (payload) => payload,
    },
    profileUpdates: {
      subscribe: async () => {
        const iterator = pubsub.asyncIterator
          ? pubsub.asyncIterator([PROFILE_UPDATES])
          : async function* () {
              const handler = (payload) => iterator.push(payload);
              pubsub.on(PROFILE_UPDATES, handler);
              try {
                while (true) {
                  yield await new Promise((resolve) => iterator.push = resolve);
                }
              } finally {
                pubsub.off(PROFILE_UPDATES, handler);
              }
            }();
        return iterator;
      },
      resolve: (payload) => payload,
    },
  },
};

// Helper functions to publish events (for testing/demo)
subscriptionResolvers.publishUserStatusUpdate = (userId, status) => {
  pubsub.emit(`${USER_STATUS_UPDATES}:${userId}`, status);
};
subscriptionResolvers.publishProfileUpdate = (profileUpdate) => {
  pubsub.emit(PROFILE_UPDATES, profileUpdate);
};

module.exports = subscriptionResolvers; 