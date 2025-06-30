const winston = require('winston');
const { createLogger, format, transports } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
require("dotenv").config();

const env = process.env.NODE_ENV || 'development';
const logDir = process.env.LOG_DIR || path.join(__dirname, '../logs');

// Safe JSON stringifier that handles circular references
function safeStringify(obj, space) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, val) => {
    if (val != null && typeof val === "object") {
      if (seen.has(val)) {
        return "[Circular Reference]";
      }
      seen.add(val);
    }
    return val;
  }, space);
}

// Clean metadata to remove problematic objects
function cleanMeta(meta) {
  const cleaned = {};
  
  for (const [key, value] of Object.entries(meta)) {
    try {
      // Skip properties that are likely to cause circular references
      if (key === 'req' || key === 'request' || key === 'res' || key === 'response') {
        // Extract only safe properties from request/response objects
        if (value && typeof value === 'object') {
          cleaned[key] = {
            method: value.method,
            url: value.url,
            headers: value.headers,
            statusCode: value.statusCode,
            // Add other safe properties as needed
          };
        }
        continue;
      }
      
      // Skip Socket, HTTPParser, and other Node.js internal objects
      if (value && typeof value === 'object' && 
          (value.constructor?.name === 'Socket' || 
           value.constructor?.name === 'HTTPParser' ||
           value.constructor?.name === 'IncomingMessage' ||
           value.constructor?.name === 'ServerResponse')) {
        cleaned[key] = `[${value.constructor.name} Object]`;
        continue;
      }
      
      // Try to serialize the value to check for circular references
      JSON.stringify(value);
      cleaned[key] = value;
    } catch (error) {
      // If serialization fails, use safe stringify or a placeholder
      if (error.message.includes('circular')) {
        try {
          cleaned[key] = safeStringify(value);
        } catch {
          cleaned[key] = '[Object with circular references]';
        }
      } else {
        cleaned[key] = '[Unserializable object]';
      }
    }
  }
  
  return cleaned;
}

const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json({
    replacer: (key, value) => {
      // Apply safe stringification at the format level as well
      if (value != null && typeof value === "object") {
        const seen = new WeakSet();
        try {
          JSON.stringify(value, (k, v) => {
            if (v != null && typeof v === "object") {
              if (seen.has(v)) throw new Error("Circular reference detected");
              seen.add(v);
            }
            return v;
          });
          return value;
        } catch {
          return "[Circular Reference Removed]";
        }
      }
      return value;
    }
  })
);

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const cleanedMeta = cleanMeta(meta);
    const metaString = Object.keys(cleanedMeta).length ? 
      safeStringify(cleanedMeta, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  })
);

const logger = createLogger({
  level: env === 'development' ? 'debug' : 'info',
  format: fileFormat,
  transports: [
    new DailyRotateFile({
      filename: 'application-%DATE%.log',
      dirname: logDir,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),
    new DailyRotateFile({
      filename: 'error-%DATE%.log',
      dirname: logDir,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    })
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      filename: 'exceptions-%DATE%.log',
      dirname: logDir,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
    })
  ],
  exitOnError: false,
});

if (env !== 'production') {
  logger.add(new transports.Console({
    format: consoleFormat,
    level: 'debug',
  }));
}

// Override the default log methods to ensure safe serialization
const originalLog = logger.log;
logger.log = function(level, message, meta = {}) {
  try {
    const cleanedMeta = cleanMeta(meta);
    return originalLog.call(this, level, message, cleanedMeta);
  } catch (error) {
    // Fallback: log without meta if cleaning fails
    return originalLog.call(this, level, message, { 
      error: 'Failed to serialize log metadata',
      originalError: error.message 
    });
  }
};

// Also override specific level methods
['error', 'warn', 'info', 'debug'].forEach(level => {
  const originalMethod = logger[level];
  logger[level] = function(message, meta = {}) {
    try {
      const cleanedMeta = cleanMeta(meta);
      return originalMethod.call(this, message, cleanedMeta);
    } catch (error) {
      // Fallback: log without meta if cleaning fails
      return originalMethod.call(this, message, { 
        error: 'Failed to serialize log metadata',
        originalError: error.message 
      });
    }
  };
});

module.exports = logger;