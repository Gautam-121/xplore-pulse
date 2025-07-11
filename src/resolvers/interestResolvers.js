const { requireAuth } = require('../middleware/auth');
const paginate = require('../utils/paginate');
const interestService = require('../services/interestService');
const { GraphQLError } = require('graphql');
const logger = require("../utils/logger")


const interestResolvers = {
  Query: {
    interests: requireAuth(async (_, args) => {
      try {
        return await interestService.fetchInterests({
          ...args,
          paginate
        });
      } catch (error) {
        logger.error('fetch Interest resolver failed', { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('fetch interest failed', {
          extensions: { code: 'FETCH_FAILED' }
        });
      }
    })
  },

  Mutation: {
    createInterest: requireAuth(async (_, { input }) => {
      try {
        return await interestService.createInterest(input)
      } catch (error) {
        logger.error('Create Interest resolver failed', { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Create interest failed', {
          extensions: { code: 'CREATE_FAILED' }
        });
      }
    }),
    createInterests: requireAuth(async (_, { inputs }) => {
      try {
        return await interestService.createInterests(inputs);
      } catch (error) {
        logger.error('Bulk Create Interests resolver failed', { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Bulk create interests failed', {
          extensions: { code: 'BULK_CREATE_FAILED' }
        });
      }
    })
  }
};

module.exports = interestResolvers;


