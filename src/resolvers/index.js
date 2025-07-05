const userResolvers = require('./userResolvers');
const interestResolvers = require('./interestResolvers');
const authResolvers = require('./authResolvers');
const subscriptionResolvers = require('./subscriptionResolvers');
const communityResolvers = require("./communityResolver")

module.exports = {
  Query: {
    ...userResolvers.Query,
    ...interestResolvers.Query,
    ...authResolvers.Query,
    ...communityResolvers.Query
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...authResolvers.Mutation,
    ...interestResolvers.Mutation,
    ...communityResolvers.Mutation
  },
  Subscription: {
    ...subscriptionResolvers.Subscription
  },
  User: userResolvers.User,
}; 