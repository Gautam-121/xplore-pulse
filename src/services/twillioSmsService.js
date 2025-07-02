const twilio = require('twilio');
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

class SMSService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    logger.info('SMSService initialized with Twilio Account SID', { accountSid: process.env.TWILIO_ACCOUNT_SID });
  }

  /**
   * check health status of smsService
  */
  async healthCheck() {
    try {
      const account = await this.client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      return {
        service: 'Twilio',
        status: 'healthy',
        accountSid: account.sid,
      };
    } catch (error) {
      return {
        service: 'Twilio',
        status: 'unhealthy',
        error: error.message,
      };
    }
  }
  
  /**
   * Sends a general SMS message
   */
  async sendSMS(phoneNumber, countryCode, message) {
    const fullNumber = `${countryCode}${phoneNumber}`;
    logger.debug('SMSService: Sending SMS', { to: fullNumber });
    
    try {
      const result = await this.client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: fullNumber
      });

      logger.info('SMSService: SMS sent', { to: fullNumber, sid: result.sid });
      return { success: true, messageId: result.sid };
    } catch (error) {
      logger.error('SMSService: Failed to send SMS', { to: fullNumber, error });
      console.log('error', error);
      throw new GraphQLError('Failed to send SMS', { extensions: { code: 'SMS_SEND_FAILED' } });
    }
  }

  /**
   * Sends an OTP message using a predefined format
   */
  async sendOTPSMS(phoneNumber, countryCode, otpCode) {
    const message = `Your Xplore verification code is: ${otpCode}. This code will expire in 10 minutes.`;
    logger.debug('SMSService: Preparing to send OTP', { to: `${countryCode}${phoneNumber}` });

    try {
      const result = await this.sendSMS(phoneNumber, countryCode, message);
      logger.info('SMSService: OTP SMS sent successfully', { to: `${countryCode}${phoneNumber}` });
      return result;
    } catch (error) {
      logger.error('SMSService: Failed to send OTP', { to: `${countryCode}${phoneNumber}`, error });
      throw error;
    }
  }
}

module.exports = new SMSService();
