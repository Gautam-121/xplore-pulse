const { Op } = require('sequelize');

/**
 * Encodes a cursor object to base64 string
 * Used for cursor-based pagination
 */
function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

/**
 * Decodes a base64 string back to cursor object
 * If invalid, returns null
 */
function decodeCursor(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
  } catch (err) {
    // Log the malformed cursor (optional)
    // logger.warn('Failed to decode pagination cursor', { error: err.message });
    return null;
  }
}

/**
 * Composite cursor-based pagination for Sequelize models
 *
 * @param {Object} options
 * @param {Model} options.model - Sequelize model to query
 * @param {Object} [options.where] - Filter conditions
 * @param {Array} [options.order] - Array of order clauses, default: [['id', 'ASC']]
 * @param {number} [options.limit] - Page size, default: 10
 * @param {string} [options.after] - Cursor for next page
 * @param {Function} [options.toCursor] - Function to extract cursor object from row
 * @param {...any} [rest] - Additional Sequelize options (e.g., include)
 * @returns {Promise<{edges, pageInfo, totalCount}>}
 */
async function paginate({
  model,
  where = {},
  order = [['id', 'ASC']],
  limit = 10,
  after,
  toCursor = row => ({ id: row.id }),
  ...rest
}) {
  try {
    const baseWhere = { ...where }; // Preserve original filters for total count

    // Decode the `after` cursor and build composite filtering
    if (after) {
      const cursorObj = decodeCursor(after);

      if (cursorObj) {
        const orConditions = [];

        // Build OR-AND conditions for composite pagination
        for (let i = order.length - 1; i >= 0; i--) {
          const andCondition = {};

          // Match all previous sort fields
          for (let j = 0; j < i; j++) {
            const [field] = order[j];
            andCondition[field] = cursorObj[field];
          }

          // Add comparison for the current field
          const [field, direction] = order[i];
          andCondition[field] = {
            [direction === 'DESC' ? Op.lt : Op.gt]: cursorObj[field]
          };

          orConditions.push(andCondition);
        }

        // Inject pagination conditions
        where = {
          ...where,
          [Op.or]: orConditions
        };
      }
    }

    // Fetch rows + 1 to determine if there's a next page
    const rows = await model.findAll({
      where,
      order,
      limit: limit + 1,
      ...rest
    });

    const hasNextPage = rows.length > limit;

    const edges = rows.slice(0, limit).map(row => ({
      node: row,
      cursor: encodeCursor(toCursor(row))
    }));

    // Use original filter for total count (without cursor)
    const totalCount = await model.count({ where: baseWhere });

    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
      },
      totalCount
    };
  } catch (err) {
    logger.error('Pagination error', { error: err.message });
    throw new Error('Failed to paginate results. Please try again later.');
  }
}

module.exports = paginate;
