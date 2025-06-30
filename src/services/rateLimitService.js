const Redis = require('ioredis');
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

class RateLimitService {
  constructor() {
    this.redis = new Redis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST,
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        logger.warn(`Redis reconnect attempt #${times}`);
        return Math.min(times * 100, 2000); // exponential backoff up to 2s
      },
    });

    this.connected = false;

    this.redis.on('connect', () => {
      this.connected = true;
      logger.info('Redis connection established (rate limiter)');
    });
    this.redis.on('ready', () => {
      logger.info('Redis is ready to use (rate limiter)');
    });
    this.redis.on('error', (err) => {
      this.connected = false;
      logger.error('Redis error (rate limiter):', err);
    });
    this.redis.on('close', () => {
      this.connected = false;
      logger.warn('Redis connection closed (rate limiter)');
    });
    this.redis.on('reconnecting', (time) => {
      logger.warn(`Redis reconnecting in ${time}ms (rate limiter)`);
    });
    this.redis.on('end', () => {
      this.connected = false;
      logger.warn('Redis connection ended (rate limiter)');
    });
  }

  async healthCheck() {
    try {
      const pong = await this.redis.ping();
      return {
        service: 'Redis',
        status: pong === 'PONG' ? 'healthy' : 'unhealthy',
      };
    } catch (error) {
      return {
        service: 'Redis',
        status: 'unhealthy',
        error: error.message,
      };
    }
  }
  
  async checkOTPRateLimit(phoneNumber, countryCode) {
    if (!this.connected) {
      logger.error('Redis is not connected (rate limiter)');
      throw new GraphQLError('Service temporarily unavailable. Please try again later.', {
        extensions: { code: 'SERVICE_UNAVAILABLE' }
      });
    }
    const key = `otp_limit:${countryCode}${phoneNumber}`;
    const windowMs = 60 * 60 * 1000; // 1 hour
    const maxAttempts = 3;
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, Math.floor(windowMs / 1000));
    }
    if (current > maxAttempts) {
      const ttl = await this.redis.ttl(key);
      throw new GraphQLError('Too many OTP requests. Please try again later.', {
        extensions: {
          code: 'OTP_RATE_LIMIT_EXCEEDED',
          retryAfter: ttl
        }
      });
    }
    return {
      allowed: true,
      remaining: maxAttempts - current,
      resetTime: new Date(Date.now() + (await this.redis.ttl(key)) * 1000)
    };
  }

  async checkLoginRateLimit(phoneNumber, countryCode) {
    if (!this.connected) {
      logger.error('Redis is not connected (rate limiter)');
      throw new GraphQLError('Service temporarily unavailable. Please try again later.', {
        extensions: { code: 'SERVICE_UNAVAILABLE' }
      });
    }
    const key = `login_limit:${countryCode}${phoneNumber}`;
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxAttempts = 5;
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, Math.floor(windowMs / 1000));
    }
    if (current > maxAttempts) {
      const ttl = await this.redis.ttl(key);
      throw new GraphQLError('Too many login attempts. Please try again later.', {
        extensions: {
          code: 'LOGIN_RATE_LIMIT_EXCEEDED',
          retryAfter: ttl
        }
      });
    }
    return {
      allowed: true,
      remaining: maxAttempts - current
    };
  }
}

module.exports = new RateLimitService(); 