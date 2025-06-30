const db = require('../config/dbConfig');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

async function expireOldPaymentSessions() {
  try {
    const now = new Date();
    const expired = await db.PaymentSession.update(
      { status: 'EXPIRED' },
      {
        where: {
          status: { [Op.in]: ['CREATED', 'PROCESSING'] },
          expiresAt: { [Op.lt]: now }
        }
      }
    );
    logger.info('Expired old payment sessions', { count: expired[0] });
  } catch (error) {
    logger.error('Failed to expire payment sessions', { error });
  }
}

module.exports = expireOldPaymentSessions;
