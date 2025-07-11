const userResolvers = require('./userResolvers');
const interestResolvers = require('./interestResolvers');
const authResolvers = require('./authResolvers');
const communityResolvers = require("./communityResolvers")

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
  User: userResolvers.User,
}; 