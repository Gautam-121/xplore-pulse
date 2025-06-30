const userResolvers = require('./userResolvers');
const interestResolvers = require('./interestResolvers');
const authResolvers = require('./authResolvers');
const subscriptionResolvers = require('./subscriptionResolvers');

module.exports = {
  Query: {
    ...userResolvers.Query,
    ...interestResolvers.Query,
    ...authResolvers.Query
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...authResolvers.Mutation
  },
  Subscription: {
    ...subscriptionResolvers.Subscription
  },
  User: userResolvers.User,
}; 