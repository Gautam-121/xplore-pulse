const express = require('express');
const router = express.Router();

const smsService = require('../services/smsService');
const mailerService = require('../services/mailerService');
const fileUploadService = require('../services/fileUploadService');
const rateLimitService = require('../services/rateLimitService');
const { checkDatabaseHealth } = require('../config/dbEnv'); // Adjust if renamed
const db = require('../config/dbConfig'); // Sequelize instance
const { checkSystemHealth, checkDiskHealth } = require('../utils/systemHealth');

router.get('/liveness', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

router.get('/readiness', async (req, res) => {
  const checks = await Promise.all([
    smsService.healthCheck?.(),
    mailerService.healthCheck?.(),
    fileUploadService.healthCheck?.(),
    rateLimitService.healthCheck?.(),
    checkDatabaseHealth(db.sequelize),
    checkSystemHealth(),
    checkDiskHealth()
  ]);

  const services = checks.filter(Boolean);
  const unhealthy = services.filter(s => s.status !== 'healthy');

  res.status(unhealthy.length > 0 ? 503 : 200).json({
    status: unhealthy.length > 0 ? 'unhealthy' : 'healthy',
    services,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
