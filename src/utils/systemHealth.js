const os = require('os');
const checkDiskSpace = require('check-disk-space').default;

async function checkSystemHealth() {
  return {
    service: 'System',
    status: 'healthy',
    memory: {
      totalMB: (os.totalmem() / 1024 / 1024).toFixed(2),
      freeMB: (os.freemem() / 1024 / 1024).toFixed(2),
      loadAverage: os.loadavg()
    },
    uptimeSeconds: os.uptime()
  };
}

async function checkDiskHealth() {
  try {
    // Use root path depending on OS
    const path = os.platform() === 'win32' ? 'C:' : '/';
    const { free, size: total } = await checkDiskSpace(path);

    const freePercent = (free / total) * 100;
    const threshold = 10; // warn if disk < 10% free

    return {
      service: 'Disk',
      status: freePercent >= threshold ? 'healthy' : 'unhealthy',
      totalGB: (total / (1024 ** 3)).toFixed(2),
      freeGB: (free / (1024 ** 3)).toFixed(2),
      freePercent: freePercent.toFixed(2)
    };
  } catch (error) {
    return {
      service: 'Disk',
      status: 'unhealthy',
      error: error.message
    };
  }
}

module.exports = { checkSystemHealth, checkDiskHealth };
