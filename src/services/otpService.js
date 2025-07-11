const { Op } = require('sequelize');
const { GraphQLError } = require('graphql');
const db = require('../config/dbConfig');
const OTPVerification = db.OtpVerification;
const User = db.User;
const nodeMailerService = require('./mailerService');
const smsService = require("./kaleraSmsService")
const logger = require('../utils/logger');
const crypto = require('crypto');

const EMAIL_OTP_TYPE = 'EMAIL_VERIFY';
function hashOTP(otp, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(otp).digest('hex');
  return { hash, salt };
}

async function createAndStorePhoneOTP(phoneNumber, countryCode, otpType, ipAddress , userAgent) {
  // 1. Rate limiting: max 5 OTPs/hour, min 30s between requests
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  const recentOTPs = await OTPVerification.count({
    where: {
      phoneNumber,
      countryCode,
      otpType,
      createdAt: { [Op.gte]: oneHourAgo }
    }
  });
  if (recentOTPs >= 5) {
    throw new GraphQLError('Too many OTP requests. Please try again later.', {
      extensions: { code: 'OTP_RATE_LIMIT_EXCEEDED' }
    });
  }
  const lastOTP = await OTPVerification.findOne({
    where: { phoneNumber , countryCode, otpType },
    order: [['createdAt', 'DESC']]
  });
  if (lastOTP && Date.now() - lastOTP.createdAt.getTime() < 30 * 1000) {
    throw new GraphQLError('Please wait before requesting another OTP.', {
      extensions: { code: 'OTP_TOO_SOON' }
    });
  }

  // 2. Send OTP via Kaleyra
  const kaleyraSMSResult = await smsService.sendOTPSMS(phoneNumber, countryCode);

  if (!kaleyraSMSResult.success || !kaleyraSMSResult.verifyId) {
    throw new GraphQLError('Failed to initiate OTP with provider', {
      extensions: { code: 'OTP_PROVIDER_FAILED' }
    });
  }

  // 3. Expiry: 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // 4. Store OTP record
  await OTPVerification.create({
    phoneNumber,
    countryCode,
    otpType: otpType,
    verifyId: kaleyraSMSResult.verifyId,
    provider: 'KALEYRA',
    expiresAt,
    ipAddress,
    userAgent,
    providerResponse: {
      messageId: kaleyraSMSResult.messageId,
      status: kaleyraSMSResult.status,
      sentAt: new Date()
    },
    providerStatus: kaleyraSMSResult.status || 'pending',
    verificationAttempts: 0,
    maxAttempts: 5
  });

  logger.info('Phone update OTP sent successfully', {
    phoneNumber,
    countryCode,
  });
  return {
    success: true,
    message: "OTP Send Successfully",
    retryAfter: 30,
  };
}

async function verifyAndMarkPhoneOTP(phoneNumber, countryCode, otp, otpType, transaction) {
  // 1. Find latest, unexpired, unverified OTP
  const otpRecord = await OTPVerification.findOne({
    where: {
      phoneNumber,
      countryCode,
      otpType,
      isVerified: false,
      provider: "KALEYRA"
    },
    order: [['createdAt', 'DESC']],
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
    transaction
  });
  if (!otpRecord || !otpRecord.verifyId) {
    logger.warn('No valid OTP record found', { phoneNumber, countryCode, type });
    throw new GraphQLError('No valida OTP record found', {
      extensions: { code: 'INVALID_OTP_SESSION' }
    });
  }

  if (otpRecord.expiresAt < new Date()) {
    throw new GraphQLError('OTP has expired', {
        extensions: { code: 'OTP_EXPIRED' }
    });
  }

  // Check attempt limit
  if ((otpRecord.verificationAttempts + 1) >= otpRecord.maxAttempts) {
    logger.warn('Local OTP verification attempts exceeded', { phoneNumber });
    throw new GraphQLError('Maximum verification attempts exceeded', {
        extensions: { code: 'OTP_ATTEMPTS_EXCEEDED' }
    });
  }

  // Verify OTP with Kaleyra
  let kaleyraVerifyResult;
  try {
    kaleyraVerifyResult = await smsService.verifyOTP(otpRecord.verifyId, otp);
  } catch (kaleyraError) {
    await otpRecord.increment('verificationAttempts', { transaction });
    throw kaleyraError;
  }

  // Increment attempt counter
  await otpRecord.increment('verificationAttempts', { transaction });
  if (!kaleyraVerifyResult.success || !kaleyraVerifyResult.isValid) {
    await otpRecord.update({
      providerStatus: kaleyraVerifyResult.status || 'failed',
      providerResponse: {
        ...otpRecord.providerResponse,
        lastVerifyAttempt: {
          result: kaleyraVerifyResult,
          attemptedAt: new Date()
        }
      }
    }, { transaction });

    logger.warn('OTP verification failed with Kaleyra', {
      phoneNumber,
      verifyId: otpRecord.verifyId,
      status: kaleyraVerifyResult.status
    });

    throw new GraphQLError(kaleyraVerifyResult.message || 'Invalid OTP', {
      extensions: { code: 'INVALID_OTP' }
    });
  }

  // Mark as verified
  await otpRecord.update({
    isVerified: true,
    verifiedAt: new Date(),
    providerStatus: kaleyraVerifyResult.status || 'approved',
    providerResponse: {
      ...otpRecord.providerResponse,
      verificationResult: {
        result: kaleyraVerifyResult,
        verifiedAt: new Date()
      }
    }
  }, { transaction });
  return {
    success: true,
    message: 'OTP verified successfully.'
  };
}

async function sendEmailOTP(userId, email, ipAddress, userAgent , transaction=null) {
  try {
    // 1. Check if email is already used by another user
    const existingUser = await User.findOne({ 
      where: { 
        email,
      },
      ...(transaction && { transaction })
    });
    
    if (existingUser && existingUser.id !== userId) {
      throw new GraphQLError('Email already in use by another account', { 
        extensions: { code: 'EMAIL_IN_USE' } 
      });
    }

    if(existingUser && existingUser.id === userId && existingUser.isEmailVerified){
      throw new GraphQLError("Your email is already verified",{
        extensions: { code: "EMAIL_VERIFIED"}
      })
    }

    // 2. Rate limiting: max 5 OTPs/hour, min 30s between requests
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentOTPs = await OTPVerification.count({
      where: { 
        userId, 
        email, 
        otpType: EMAIL_OTP_TYPE, 
        createdAt: { [Op.gte]: oneHourAgo } 
      },
      ...(transaction && { transaction })
    });

    if (recentOTPs >= 5) {
      throw new GraphQLError('Too many OTP requests. Please try again later.', {
        extensions: { code: 'EMAIL_OTP_RATE_LIMIT' }
      });
    }

    const lastOTP = await OTPVerification.findOne({
      where: { userId, email, otpType: EMAIL_OTP_TYPE },
      order: [['createdAt', 'DESC']],
      ...(transaction && { transaction })
    });
    
    if (lastOTP && Date.now() - lastOTP.createdAt.getTime() < 30 * 1000) {
      throw new GraphQLError('Please wait before requesting another OTP.', {
        extensions: { code: 'EMAIL_OTP_TOO_SOON' }
      });
    }

    // 3. Generate OTP (6 digits)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const { hash: otpHash, salt: otpSalt } = hashOTP(otp);

    // 4. Send OTP via NodeMailer
    const mailerEmailResult = await nodeMailerService.sendOTPEmail(email, otp);
    
    if (!mailerEmailResult.success) {
      throw new GraphQLError('Failed to send OTP email', {
        extensions: { code: 'EMAIL_SEND_FAILED' }
      });
    }

    // 5. Expiry: 10 minutes
    const expiresAt = Date.now() + 10 * 60 * 1000

    // 7. Store OTP
    await OTPVerification.create({
      userId,
      email,
      otpHash,
      otpSalt,
      otpType: EMAIL_OTP_TYPE,
      provider: 'MANUAL',
      expiresAt,
      ipAddress,
      userAgent,
      providerResponse: {
        messageId: mailerEmailResult.messageId,
        status: mailerEmailResult.status || 'sent',
        sentAt: new Date()
      },
      providerStatus: mailerEmailResult.status || 'pending',
      verificationAttempts: 0,
      maxAttempts: 5
    }, transaction ? { transaction } : undefined);

    // 8. Log success
    logger.info('Email OTP sent successfully', {
      userId,
      email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3'), // Mask email in logs
      expiresAt,
      type: EMAIL_OTP_TYPE
    });

    return { 
      success: true, 
      message: 'OTP sent to your email',
      retryAfter: 30
    };
  } catch (error) {
    logger.error('Failed to send email OTP', {
      userId,
      email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3'),
      error: error.message,
      code: error.extensions?.code
    });
    
    // Re-throw GraphQL errors, wrap others
    if (error instanceof GraphQLError) {
      throw error;
    }
    
    throw new GraphQLError('Failed to send email verification', {
      extensions: { code: 'EMAIL_OTP_SEND_FAILED' }
    });
  }
}

async function verifyEmailOTP(userId, email, otp, transaction = null) {
  const otpRecord = await OTPVerification.findOne({
    where: {
      userId,
      email,
      otpType: EMAIL_OTP_TYPE,
      isVerified: false,
    },
    order: [['createdAt', 'DESC']],
    lock: transaction?.LOCK?.UPDATE,
    transaction
  });

  if (!otpRecord) {
    logger.warn('No valid OTP record found', { email });
    throw new GraphQLError('No valid OTP record found', {
      extensions: { code: 'INVALID_OTP_SESSION' }
    });
  }

  if (otpRecord.expiresAt < new Date()) {
    throw new GraphQLError('OTP has expired', {
      extensions: { code: 'OTP_EXPIRED' }
    });
  }

  if ((otpRecord.verificationAttempts + 1) >= otpRecord.maxAttempts) {
    logger.warn('OTP attempts exceeded', { email });
    throw new GraphQLError('Maximum verification attempts exceeded', {
      extensions: { code: 'OTP_ATTEMPTS_EXCEEDED' }
    });
  }

  const { hash: providedHash } = hashOTP(otp, otpRecord.otpSalt);
  if (providedHash !== otpRecord.otpHash) {
    await otpRecord.increment('verificationAttempts', { transaction });
    throw new GraphQLError('Invalid OTP', {
      extensions: { code: 'INVALID_EMAIL_OTP' }
    });
  }

  await otpRecord.update({ isVerified: true , verifiedAt: new Date()}, { transaction });

  logger.info('Email verified', { userId, email });

  return { success: true, message: 'Email verified successfully' };
}


module.exports = {
  sendEmailOTP,
  verifyEmailOTP,
  createAndStorePhoneOTP,
  verifyAndMarkPhoneOTP
}; 