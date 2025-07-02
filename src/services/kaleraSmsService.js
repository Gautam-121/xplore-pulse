const axios = require('axios');
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

class KaleyraSMSService {
  constructor() {
    this.baseUrl = 'https://api.kaleyra.io/v1';
    this.accountSid = process.env.KALEYRA_ACCOUNT_SID;
    this.apiKey = process.env.KALEYRA_API_KEY;
    this.flowId = process.env.KALEYRA_FLOW_ID;
    
    if (!this.accountSid || !this.apiKey || !this.flowId) {
      logger.error('KaleyraSMSService: Missing required environment variables');
      throw new Error('Kaleyra configuration incomplete');
    }

    this.axiosInstance = axios.create({
      baseURL: `${this.baseUrl}/${this.accountSid}`,
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey
      },
      timeout: 30000 // 30 seconds timeout
    });

    logger.info('Kaleyra SMSService initialized');
  }

  /**
   * Maps Kaleyra error codes to user-friendly messages and GraphQL error codes
   */
  mapKaleyraError(errorResponse) {
    const errorData = errorResponse?.data?.error;
    if (!errorData) {
      return {
        message: 'Unknown error occurred',
        code: 'UNKNOWN_ERROR'
      };
    }

    const errorMappings = {
      // OTP Generation Errors
      'E804': {
        message: 'Mobile number is required',
        code: 'MOBILE_NUMBER_REQUIRED'
      },
      'E805': {
        message: 'Please provide a valid mobile number (3-20 digits)',
        code: 'INVALID_MOBILE_NUMBER'
      },
      'E802': {
        message: 'Please provide a valid email address',
        code: 'INVALID_EMAIL'
      },
      'E903': {
        message: 'OTP length does not match the configured length',
        code: 'OTP_LENGTH_MISMATCH'
      },
      'E905': {
        message: 'Invalid or unapproved flow configuration',
        code: 'INVALID_FLOW_ID'
      },
      'E600': {
        message: 'Recipient information is required',
        code: 'RECIPIENT_REQUIRED'
      },
      'E803': {
        message: 'OTP must contain only alphanumeric characters',
        code: 'INVALID_OTP_FORMAT'
      },
      'E914': {
        message: 'This flow does not support alphanumeric OTP',
        code: 'ALPHANUMERIC_OTP_NOT_SUPPORTED'
      },
      
      // OTP Verification Errors
      'E910': {
        message: 'This OTP has already been verified',
        code: 'OTP_ALREADY_VERIFIED'
      },
      'E912': {
        message: 'Invalid OTP provided',
        code: 'INVALID_OTP'
      },
      'E909': {
        message: 'Verification session not found',
        code: 'VERIFICATION_SESSION_NOT_FOUND'
      },
      'E911': {
        message: 'Maximum verification attempts exceeded',
        code: 'MAX_ATTEMPTS_EXCEEDED'
      },
      'E913': {
        message: 'OTP has expired, please request a new one',
        code: 'OTP_EXPIRED'
      },
      'E801': {
        message: 'OTP is required for verification',
        code: 'OTP_REQUIRED'
      },
      'E800': {
        message: 'Verification ID is required',
        code: 'VERIFY_ID_REQUIRED'
      }
    };

    const mapping = errorMappings[errorData.code];
    if (mapping) {
      return mapping;
    }

    // Fallback for unmapped errors
    return {
      message: errorData.message || 'Service error occurred',
      code: 'KALEYRA_ERROR'
    };
  }

  /**
   * Validates phone number format
   */
  validatePhoneNumber(phoneNumber, countryCode) {
    if (!phoneNumber || !countryCode) {
      throw new GraphQLError('Phone number and country code are required', {
        extensions: { code: 'MOBILE_NUMBER_REQUIRED' }
      });
    }

    // Remove any non-digit characters from phone number
    const cleanPhoneNumber = phoneNumber.replace(/\D/g, '');
    
    if (cleanPhoneNumber.length < 3 || cleanPhoneNumber.length > 20) {
      throw new GraphQLError('Phone number must be between 3 and 20 digits', {
        extensions: { code: 'INVALID_MOBILE_NUMBER' }
      });
    }

    // Ensure country code starts with +
    const cleanCountryCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;

    return {
      phoneNumber: cleanPhoneNumber,
      countryCode: cleanCountryCode,
      fullNumber: `${cleanCountryCode}${cleanPhoneNumber}`
    };
  }

  /**
   * Sends OTP using Kaleyra's verify API
   * @param {string} phoneNumber - Phone number without country code
   * @param {string} countryCode - Country code (e.g., '+91')
   * @param {string} email - Optional email address
   * @returns {Promise<{success: boolean, verifyId: string, messageId?: string}>}
   */
  async sendOTPSMS(phoneNumber, countryCode, email = null) {
    try {
      // Validate and format phone number
      const { fullNumber } = this.validatePhoneNumber(phoneNumber, countryCode);
      
      logger.debug('KaleyraSMSService: Sending OTP via Kaleyra', { 
        to: fullNumber,
        email: email ? 'provided' : 'not provided'
      });

      const requestBody = {
        flow_id: this.flowId,
        to: {
          mobile: fullNumber
        }
      };

      // Add email if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new GraphQLError('Please provide a valid email address', {
            extensions: { code: 'INVALID_EMAIL' }
          });
        }
        requestBody.to.email = email;
      }

      logger.debug('KaleyraSMSService: Request payload', { 
        requestBody: { ...requestBody, to: { ...requestBody.to, mobile: '***masked***' } }
      });

      const response = await this.axiosInstance.post('/verify', requestBody);
      
      if (response.data && response.data.data && response.data.data.verify_id) {
        logger.info('KaleyraSMSService: OTP sent successfully', { 
          to: '***masked***', 
          verifyId: response.data.data.verify_id
        });
        
        return { 
          success: true, 
          verifyId: response.data.data.verify_id,
          messageId: response.data.data.verify_id, // Using verify_id as messageId for compatibility
          flowId: response.data.data.flow_id
        };
      } else {
        logger.error('KaleyraSMSService: Invalid response format', { 
          hasData: !!response.data,
          hasVerifyId: !!(response.data?.data?.verify_id)
        });
        throw new GraphQLError('Invalid response from OTP service', { 
          extensions: { code: 'OTP_SERVICE_ERROR' } 
        });
      }

    } catch (error) {
      // If it's already a GraphQLError (from validation), re-throw it
      if (error instanceof GraphQLError) {
        throw error;
      }

      logger.error('KaleyraSMSService: Failed to send OTP', { 
        error: error.message,
        status: error.response?.status,
        errorData: error.response?.data 
      });

      // Handle HTTP status codes
      if (error.response?.status === 401) {
        throw new GraphQLError('OTP service authentication failed', { 
          extensions: { code: 'OTP_AUTH_FAILED' } 
        });
      } else if (error.response?.status === 429) {
        throw new GraphQLError('Too many OTP requests. Please try again later', { 
          extensions: { code: 'OTP_RATE_LIMIT_EXCEEDED' } 
        });
      } else if (error.response?.status >= 400 && error.response?.status < 500) {
        // Handle specific Kaleyra error codes
        const mappedError = this.mapKaleyraError(error.response);
        throw new GraphQLError(mappedError.message, { 
          extensions: { code: mappedError.code } 
        });
      } else if (error.code === 'ECONNABORTED') {
        throw new GraphQLError('OTP service request timed out', { 
          extensions: { code: 'OTP_SERVICE_TIMEOUT' } 
        });
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new GraphQLError('OTP service is currently unavailable', { 
          extensions: { code: 'OTP_SERVICE_UNAVAILABLE' } 
        });
      }

      throw new GraphQLError('Failed to send OTP. Please try again', { 
        extensions: { code: 'SMS_SEND_FAILED' } 
      });
    }
  }

  /**
   * Verifies OTP using Kaleyra's validate API
   * @param {string} verifyId - The verify ID returned from sendOTPSMS
   * @param {string} otp - The OTP code to verify
   * @returns {Promise<{success: boolean, isValid: boolean, status?: string}>}
   */
  async verifyOTP(verifyId, otp) {
    try {
      // Validate inputs
      if (!verifyId) {
        throw new GraphQLError('Verification ID is required', {
          extensions: { code: 'VERIFY_ID_REQUIRED' }
        });
      }

      if (!otp) {
        throw new GraphQLError('OTP is required for verification', {
          extensions: { code: 'OTP_REQUIRED' }
        });
      }

      // Validate OTP format - only alphanumeric
      const alphanumericRegex = /^[a-zA-Z0-9]+$/;
      if (!alphanumericRegex.test(otp)) {
        throw new GraphQLError('OTP must contain only alphanumeric characters', {
          extensions: { code: 'INVALID_OTP_FORMAT' }
        });
      }

      logger.debug('KaleyraSMSService: Verifying OTP', { 
        verifyId, 
        otpLength: otp.length 
      });

      const requestBody = {
        verify_id: verifyId,
        otp: otp
      };

      const response = await this.axiosInstance.post('/verify/validate', requestBody);
      
      if (response.data && response.data.data) {
        const isValid = response.data.data.message === 'OTP verified successfully.';
        
        logger.info('KaleyraSMSService: OTP verification result', { 
          verifyId, 
          isValid,
          message: response.data.data.message
        });
        
        return { 
          success: true, 
          isValid,
          message: response.data.data.message,
          verifyId: response.data.data.verify_id
        };
      } else {
        logger.error('KaleyraSMSService: Invalid verification response format', { 
          hasData: !!response.data,
          hasDataField: !!(response.data?.data)
        });
        throw new GraphQLError('Invalid response from OTP verification service', { 
          extensions: { code: 'OTP_VERIFY_ERROR' } 
        });
      }

    } catch (error) {
      // If it's already a GraphQLError (from validation), re-throw it
      if (error instanceof GraphQLError) {
        throw error;
      }

      logger.error('KaleyraSMSService: Failed to verify OTP', { 
        verifyId, 
        error: error.message,
        status: error.response?.status,
        errorData: error.response?.data 
      });

      // Handle HTTP status codes first
      if (error.response?.status === 404) {
        throw new GraphQLError('OTP verification session not found or expired', { 
          extensions: { code: 'VERIFICATION_SESSION_NOT_FOUND' } 
        });
      } else if (error.response?.status === 429) {
        throw new GraphQLError('Too many verification attempts. Please try again later', { 
          extensions: { code: 'OTP_VERIFY_RATE_LIMIT' } 
        });
      } else if (error.response?.status === 401) {
        throw new GraphQLError('OTP service authentication failed', { 
          extensions: { code: 'OTP_AUTH_FAILED' } 
        });
      } else if (error.response?.status >= 400 && error.response?.status < 500) {
        // Handle specific Kaleyra error codes
        const mappedError = this.mapKaleyraError(error.response);
        
        // For verification errors that should return isValid: false instead of throwing
        const nonThrowingErrors = ['E912', 'E910', 'E911', 'E913'];
        if (error.response?.data?.error?.code && nonThrowingErrors.includes(error.response.data.error.code)) {
          return {
            success: true,
            isValid: false,
            message: mappedError.message,
            errorCode: error.response.data.error.code
          };
        }
        
        throw new GraphQLError(mappedError.message, { 
          extensions: { code: mappedError.code } 
        });
      } else if (error.code === 'ECONNABORTED') {
        throw new GraphQLError('OTP verification request timed out', { 
          extensions: { code: 'OTP_VERIFY_TIMEOUT' } 
        });
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new GraphQLError('OTP verification service is currently unavailable', { 
          extensions: { code: 'OTP_SERVICE_UNAVAILABLE' } 
        });
      }

      throw new GraphQLError('Failed to verify OTP. Please try again', { 
        extensions: { code: 'OTP_VERIFY_FAILED' } 
      });
    }
  }

}

module.exports = new KaleyraSMSService();