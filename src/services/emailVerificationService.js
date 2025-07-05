const { Op } = require('sequelize');
const { GraphQLError } = require('graphql');
const db = require('../config/dbConfig');
const OTPVerification = db.OtpVerification;
const User = db.User;
const nodeMailerService = require('./mailerService');
const logger = require('../utils/logger');
const crypto = require('crypto');

const EMAIL_OTP_TYPE = 'EMAIL_VERIFY';

function hashOTP(otp, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(otp).digest('hex');
  return { hash, salt };
}

async function sendEmailOTP(userId, email, ipAddress, userAgent) {
  try {
    // 1. Check if email is already used by another user
    const existingUser = await User.findOne({ 
      where: { 
        email,
      }
    });
    
    if (existingUser && existingUser.id !== userId) {
      throw new GraphQLError('Email already in use by another account', { 
        extensions: { code: 'EMAIL_IN_USE' } 
      });
    }

    if(existingUser && existingUser.id === userId){
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
      }
    });

    console.log("recentCount" , recentOTPs)
    
    if (recentOTPs >= 5) {
      throw new GraphQLError('Too many OTP requests. Please try again later.', {
        extensions: { code: 'EMAIL_OTP_RATE_LIMIT' }
      });
    }

    const lastOTP = await OTPVerification.findOne({
      where: { userId, email, otpType: EMAIL_OTP_TYPE },
      order: [['createdAt', 'DESC']]
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

    // // 6. Clean up any existing unverified OTPs for this user and email
    // await OTPVerification.destroy({
    //   where: {
    //     userId,
    //     email,
    //     otpType: EMAIL_OTP_TYPE,
    //     isVerified: false
    //   }
    // });

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
    });

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

async function verifyEmailOTP(userId, email, otp) {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Find latest, unexpired, unverified OTP
    const otpRecord = await OTPVerification.findOne({
      where: {
        userId,
        email,
        otpType: EMAIL_OTP_TYPE,
        isVerified: false,
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'DESC']],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!otpRecord) {
      throw new GraphQLError('Invalid or expired OTP session', {
        extensions: { code: 'INVALID_EMAIL_OTP_SESSION' }
      });
    }

    // 2. Attempt limit
    if (otpRecord.verificationAttempts >= otpRecord.maxAttempts) {
      throw new GraphQLError('Maximum verification attempts exceeded', {
        extensions: { code: 'EMAIL_OTP_ATTEMPTS_EXCEEDED' }
      });
    }

    // 3. Check OTP
    const { hash: providedHash } = hashOTP(otp, otpRecord.otpSalt);
    if (providedHash !== otpRecord.otpHash) {
      await otpRecord.increment('verificationAttempts', { transaction });
      throw new GraphQLError('Invalid OTP', { extensions: { code: 'INVALID_EMAIL_OTP' } });
    }

    // 4. Mark as verified
    await otpRecord.update({ isVerified: true }, { transaction });

    // 5. Mark user as verified, advance onboarding
    await User.update(
      { isVerified: true, onboardingStep: 'INTERESTS_SELECTION' },
      { where: { id: userId }, transaction }
    );

    // Fetch the updated user record
    const updatedUser = await User.findByPk(userId, { transaction });

    await transaction.commit();

    logger.info('Email verified', { userId, email });

    return { success: true, message: 'Email verified successfully.', user: updatedUser };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = {
  sendEmailOTP,
  verifyEmailOTP
}; 