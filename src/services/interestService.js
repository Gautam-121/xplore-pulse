const { Op } = require('sequelize');
const { GraphQLError } = require('graphql');
const db = require('../config/dbConfig');
const logger = require('../utils/logger');
const ValidationService = require('../utils/validation');
const { error } = require('winston');

class InterestService {
  constructor() {
    this.Interest = db.Interest;
    this.sequelize = db.sequelize;
    this.logger = logger;
  }

  /**
   * Fetch interests with filtering, pagination, and cursor-based ordering
   */
  async fetchInterests({ query, category, popular, first, after, paginate }) {
    try {
      // Validate query params
      ValidationService.validateInterestQueryParams({ query, category, popular, first, after });

      const where = { isActive: true };
      // Optional filters
      if (category) where.category = category;
      if (popular) where.isPopular = true;
      if (query?.trim()) {
        where.name = { [Op.iLike]: `%${query.trim()}%` };
      }

      this.logger.info('Fetching interests with filters', { query, category, popular });

      const result = await paginate({
        model: this.Interest,
        where,
        order: [['sortOrder', 'ASC'], ['followersCount', 'DESC'], ['id', 'ASC']],
        limit: first,
        after,
        toCursor: row => ({
          sortOrder: row.sortOrder,
          followersCount: row.followersCount,
          id: row.id
        })
      });

      if (!result || !result.edges || result.edges.length === 0) {
        this.logger.warn('No interests found', { query, category, popular });
        throw new GraphQLError('No interests found', {
          extensions: { code: 'NO_RESULTS' }
        });
      }

      this.logger.info('Interests fetched successfully', { count: result.edges.length });
      return result;

    } catch (err) {
      this.logger.error('Failed to fetch interests', { error: err.message });
      if (err instanceof GraphQLError) throw err;
      throw new GraphQLError('Internal server error while fetching interests.', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' }
      });
    }
  }

  /**
   * Create a new interest with optional sortOrder adjustment
   */
  async createInterest(input) {
    try {
      // Validate input
      ValidationService.validateCreateInterestInput(input);
      const {
        name, slug, description, iconUrl, colorHex, category, sortOrder
      } = input;

      // Check for duplicate name or slug (case-insensitive)
      const existing = await this.Interest.findOne({
        where: {
          [Op.or]: [
            { name: name.trim().toLowerCase() },
            { slug: slug.trim().toLowerCase() }
          ]
        }
      });

      if (existing) {
        this.logger.warn('Duplicate interest name or slug', { name, slug });
        throw new GraphQLError('An interest with this name or slug already exists.', {
          extensions: { code: 'DUPLICATE_ENTRY' }
        });
      }

      const t = await this.sequelize.transaction();

      try {
        let finalSortOrder = 0;

        // If sortOrder provided, increment existing ones to shift position
        if (typeof sortOrder === 'number' && !isNaN(sortOrder)) {
          await this.Interest.increment(
            { sortOrder: 1 },
            {
              where: { category, sortOrder: { [Op.gte]: sortOrder } },
              transaction: t
            }
          );
          finalSortOrder = sortOrder;
        } else {
          // Otherwise, set to max sortOrder + 1
          const max = await this.Interest.max('sortOrder', { where: { category } });
          finalSortOrder = typeof max === 'number' && !isNaN(max) ? max + 1 : 0;
        }

        // Create the interest
        await this.Interest.create({
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
        this.logger.error('Interest creation failed, transaction rolled back', { error: error.message });

        if (error instanceof GraphQLError) throw error;
        if (error.name === 'SequelizeValidationError') {
          throw new GraphQLError(error.errors[0].message, {
            extensions: { code: 'BAD_USER_INPUT' }
          });
        }

        throw new GraphQLError('Failed to create interest.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }

    } catch (err) {
      this.logger.error('Unhandled error during interest creation', { error: err.message });
      if (err instanceof GraphQLError) throw err;
      throw new GraphQLError('Internal server error during interest creation.', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' }
      });
    }
  }

  /**
   * Bulk create interests
   */
  async createInterests(inputs) {
    const responses = [];
    let t;
    try {
      // Validate all inputs and check for duplicates in input array
      ValidationService.validateBulkCreateInterestInputs(inputs);

      t = await this.sequelize.transaction();

      // Check for duplicates in DB (name or slug)
      const names = inputs.map(i => i.name.trim().toLowerCase());
      const slugs = inputs.map(i => i.slug.trim().toLowerCase());
      const existing = await this.Interest.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.in]: names } },
            { slug: { [Op.in]: slugs } }
          ]
        },
        transaction: t
      });
      const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
      const existingSlugs = new Set(existing.map(e => e.slug.toLowerCase()));

      // Prepare to create only non-duplicate ones
      for (const input of inputs) {
        const name = input.name.trim().toLowerCase();
        const slug = input.slug.trim().toLowerCase();
        if (existingNames.has(name) || existingSlugs.has(slug)) {
          responses.push({
            success: false,
            message: `Interest with name '${input.name}' or slug '${input.slug}' already exists.`
          });
          continue;
        }
        // Validate again for safety (should already be valid)
        try {
          ValidationService.validateCreateInterestInput(input);
          let finalSortOrder = 0;
          if (typeof input.sortOrder === 'number' && !isNaN(input.sortOrder)) {
            await this.Interest.increment(
              { sortOrder: 1 },
              {
                where: { category: input.category, sortOrder: { [Op.gte]: input.sortOrder } },
                transaction: t
              }
            );
            finalSortOrder = input.sortOrder;
          } else {
            const max = await this.Interest.max('sortOrder', { where: { category: input.category }, transaction: t });
            finalSortOrder = typeof max === 'number' && !isNaN(max) ? max + 1 : 0;
          }
          await this.Interest.create({
            name: input.name.trim(),
            slug: input.slug.trim(),
            description: input.description,
            iconUrl: input.iconUrl,
            colorHex: input.colorHex,
            category: input.category,
            sortOrder: finalSortOrder,
            isActive: true
          }, { transaction: t });
          responses.push({
            success: true,
            message: `Interest '${input.name}' created successfully.`
          });
        } catch (err) {
          this.logger.error('Bulk create interest failed for input', { input, error: err.message });
          responses.push({
            success: false,
            message: err.message || 'Failed to create interest.'
          });
        }
      }
      await t.commit();
      return responses;
    } catch (err) {
      if (t) {
        try { await t.rollback(); } catch (rollbackErr) {
          this.logger.error('Bulk interest creation rollback failed', { error: rollbackErr.message });
        }
      }
      this.logger.error('Bulk interest creation failed, transaction rolled back', { error: err.message });
      if(err instanceof GraphQLError) throw err
      // Only throw for true system/transaction errors
      throw new GraphQLError('Bulk interest creation system error.', {
        extensions: { code: 'BULK_CREATE_FAILED', detail: err.message }
      });
    }
  }
}

module.exports = new InterestService();
 