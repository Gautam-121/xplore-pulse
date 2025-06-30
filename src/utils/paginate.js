const { Op } = require('sequelize');

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function decodeCursor(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Composite cursor-based pagination for Sequelize
 * @param {Model} model - Sequelize model
 * @param {Object} options - { where, order, limit, after, toCursor, ... }
 * @param {Function} toCursor - function to get cursor object from row (default: row => ({ id: row.id }))
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
  // Save the base filter for totalCount
  const baseWhere = { ...where };

  // If after is provided, decode the cursor and add to where clause
  if (after) {
    const cursorObj = decodeCursor(after);
    if (cursorObj) {
      // Build composite where for all order fields
      const orConditions = [];
      for (let i = order.length - 1; i >= 0; i--) {
        const andCond = {};
        for (let j = 0; j < i; j++) {
          const [field] = order[j];
          andCond[field] = cursorObj[field];
        }
        const [field, direction] = order[i];
        andCond[field] = {
          [direction === 'DESC' ? Op.lt : Op.gt]: cursorObj[field]
        };
        orConditions.push(andCond);
      }
      where = {
        ...where,
        [Op.or]: orConditions
      };
    }
  }

  // Fetch one extra to check for next page
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

  // Use baseWhere for totalCount (ignoring cursor)
  const totalCount = await model.count({ where: baseWhere });

  return {
    edges,
    pageInfo: {
      hasNextPage,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
    },
    totalCount
  };
}

module.exports = paginate; 