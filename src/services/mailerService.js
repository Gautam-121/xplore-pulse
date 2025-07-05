const nodemailer = require('nodemailer');
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

class MailerService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true, // For better connection handling in production
      tls: {
        rejectUnauthorized: true 
      },
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: true
    });

    this.defaultFrom = process.env.SMTP_USER || 'no-reply@xplore.app';

    this.transporter.verify((err, success) => {
      if (err) {
        logger.error('MailerService: Transporter verification failed', {err});
      } else {
        logger.info('MailerService: SMTP transporter verified and ready');
      }
    });
  }

  async healthCheck() {
    return new Promise((resolve) => {
      this.transporter.verify((err, success) => {
        if (err) {
          resolve({
            service: 'SMTP',
            status: 'unhealthy',
            error: err.message,
          });
        } else {
          resolve({
            service: 'SMTP',
            status: 'healthy',
          });
        }
      });
    });
  }
  
  /**
   * Sends a generic email
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient
   * @param {string} options.subject - Subject
   * @param {string} options.text - Plain text
   * @param {string} options.html - HTML content
   */
  async sendEmail({ to, subject, text, html }) {
    if (!to || !subject || (!text && !html)) {
      logger.warn('MailerService: Missing email parameters');
      throw new GraphQLError('Missing email parameters', { extensions: { code: 'BAD_USER_INPUT' } });
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.defaultFrom,
        to,
        subject,
        text,
        html
      });

      logger.info('MailerService: Email sent to (Message ID)', {to, messageId:info.messageId});
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('MailerService: Failed to send email to',{ to, error});
      throw new GraphQLError('Failed to send email', { extensions: { code: 'EMAIL_SEND_FAILED' } });
    }
  }

  /**
   * Sends a predefined OTP email
   * @param {string} to - Recipient email
   * @param {string|number} otp - One-time password
   */
  async sendOTPEmail(to, otp) {
    const subject = 'Your Xplore OTP Code';
    const text = `Your OTP code is: ${otp}`;
    const html = `<p>Your OTP code is: <b>${otp}</b></p>`;

    try {
      logger.debug('MailerService: Sending OTP email to',{ to });
      return await this.sendEmail({ to, subject, text, html });
    } catch (error) {
      logger.error('MailerService: Error sending OTP email to',{ to, error});
      return { success: false, error: 'Email delivery failed' };
    }
  }
}

module.exports = new MailerService();
