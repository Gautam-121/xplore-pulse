const userResolvers = require('./userResolvers');
const interestResolvers = require('./interestResolvers');
const authResolvers = require('./authResolvers');
const communityResolvers = require("./communityResolvers")
const communityPostResolvers = require("./communityPostResolvers")

module.exports = {
  Query: {
    ...userResolvers.Query,
    ...interestResolvers.Query,
    ...authResolvers.Query,
    ...communityResolvers.Query,
    ...communityPostResolvers.Query
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...authResolvers.Mutation,
    ...interestResolvers.Mutation,
    ...communityResolvers.Mutation,
    ...communityPostResolvers.Mutation
  },
  User: userResolvers.User,
}; 