const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const db = require('../config/dbConfig');
const Interest = db.Interest;
const logger = require('../utils/logger');
const paginate = require('../utils/paginate');
const { requireAuth } = require('../middleware/auth');

const interestResolvers = {
  Query: {
    interests: requireAuth(async (_, { query, category, popular, first = 10, after }) => {
      const where = { isActive: true };
      if (category) where.category = category;
      if (popular) where.isPopular = true;
      if (query && query.trim() !== '') {
        where.name = { [Op.iLike]: `%${query.trim()}%` };
      }
      logger.info('Fetching interests with filters', { query, category, popular });
      try {
        const result = await paginate({
          model: Interest,
          where,
          order: [['sortOrder', 'ASC'], ['followersCount', 'DESC'], ['id', 'ASC']],
          limit: first,
          after,
          toCursor: row => ({ sortOrder: row.sortOrder, followersCount: row.followersCount, id: row.id })
        });
        if (result.edges.length === 0) {
          logger.warn('No interests found for filters', { query, category, popular });
          throw new GraphQLError('No interests found for the specified filters', {
            extensions: { code: 'NO_RESULTS' }
          });
        }
        logger.info('Fetched interests successfully', { count: result.edges.length });
        return result;
      } catch (error) {
        logger.error('Error fetching interests', { error: error.message });
        if(error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to fetch interests', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    })
  }
};

module.exports = interestResolvers;
