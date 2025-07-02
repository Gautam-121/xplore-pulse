const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const db = require('../config/dbConfig');
const Interest = db.Interest;
const logger = require('../utils/logger');
const sequelize = db.sequelize
const paginate = require('../utils/paginate');
const { requireAuth, requireRole } = require('../middleware/auth');

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
  },
  Mutation: {
    createInterest: (async (_, { input }) => {
      const {
        name, slug, description, iconUrl, colorHex, category, sortOrder
      } = input;

      // Validate required fields
      if (!name || !slug || !category) {
        throw new GraphQLError('Name, slug, and category are required.', {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }

      // Validate colorHex
      if (colorHex && !/^#[0-9A-F]{6}$/i.test(colorHex)) {
        throw new GraphQLError('colorHex must be a valid hex color (e.g., #AABBCC)', {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }

      // Check for duplicate name or slug
      const existing = await Interest.findOne({
        where: {
          [Op.or]: [
            { name: name.trim()?.toLowerCase() },
            { slug: slug.trim()?.toLowerCase()}
          ]
        }
      });
      if (existing) {
        throw new GraphQLError('An interest with this name or slug already exists.', {
          extensions: { code: 'DUPLICATE' }
        });
      }

      const t = await sequelize.transaction();
      try {
        let finalSortOrder = 0;
        if (typeof sortOrder === 'number' && !isNaN(sortOrder)) {
          // Auto-adjust: increment sortOrder of all at or after this value in the same category
          await Interest.increment(
            { sortOrder: 1 },
            {
              where: {
                category,
                sortOrder: { [Op.gte]: sortOrder }
              },
              transaction: t
            }
          );
          finalSortOrder = sortOrder;
        } else {
          // If not provided, append to end (max+1)
          const max = await Interest.max('sortOrder', { where: { category } });
          finalSortOrder = (typeof max === 'number' && !isNaN(max)) ? max + 1 : 0;
        }

        await Interest.create({
          name: name.trim(),
          slug: slug.trim(),
          description,
          iconUrl,
          colorHex,
          category,
          sortOrder: finalSortOrder,
          isActive: true
        }, { transaction: t });

        await t.commit();
        return {
          success: true,
          message: 'Interest created successfully.'
        };
      } catch (error) {
        await t.rollback();
        if (error.name === 'SequelizeValidationError') {
          throw new GraphQLError(error.errors[0].message, {
            extensions: { code: 'BAD_USER_INPUT' }
          });
        }
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to create interest.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    })
  }
};

module.exports = interestResolvers;
