const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { GraphQLError } = require('graphql');
const db = require("../config/dbConfig")
const sequelize = db.sequelize
const User = db.User
const AuthSession = db.AuthSession
const OTPVerification = db.OtpVerification
const { requireAuth } = require("../middleware/auth")
const smsService = require('../services/kaleraSmsService');
const logger = require('../utils/logger');
const { OAuth2Client } = require('google-auth-library');
const { Op } = require('sequelize');

// Helper function to format device names
const formatDeviceName = (deviceType, deviceName, userAgent) => {
  if (deviceName) return deviceName;

  if (deviceType === 'iOS') return 'iPhone/iPad';
  if (deviceType === 'Android') return 'Android Device';
  if (deviceType === 'Web') {
    // Try to extract browser info from user agent
    if (userAgent?.includes('Chrome')) return 'Chrome Browser';
    if (userAgent?.includes('Firefox')) return 'Firefox Browser';
    if (userAgent?.includes('Safari')) return 'Safari Browser';
    if (userAgent?.includes('Edge')) return 'Edge Browser';
    return 'Web Browser';
  }

  return 'Unknown Device';
};

const authResolvers = {
  Query: {
    activeSessions: requireAuth(async (_, __, { user, deviceId: currentDeviceId }) => {
      logger.info('Fetching active sessions', { userId: user.id });
      try {
        const sessions = await AuthSession.findAll({
          where: {
            userId: user.id,
            isActive: true,
            refreshExpiresAt: { [Op.gt]: new Date() }
          },
          order: [['lastUsedAt', 'DESC']]
        });
        const sessionsWithCurrentFlag = sessions.map(session => ({
          id: session.id,
          deviceId: session.deviceId,
          deviceType: session.deviceType,
          deviceName: formatDeviceName(session.deviceType, session.deviceName, session.userAgent),
          appVersion: session.appVersion,
          osVersion: session.osVersion,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          lastUsedAt: session.lastUsedAt,
          tokenExpiresAt: session.tokenExpiresAt,
          refreshExpiresAt: session.refreshExpiresAt,
          isCurrentSession: session.deviceId === currentDeviceId
        }));
        logger.info('Active sessions fetched', {
          userId: user.id,
          sessionCount: sessionsWithCurrentFlag.length
        });
        return {
          success: true,
          sessions: sessionsWithCurrentFlag,
          totalCount: sessionsWithCurrentFlag.length
        };
      } catch (error) {
        if (error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to fetch activeSessions', { extensions: { code: 'FETCH_ACTIVE_SESSIONS' } });
      }
    })
  },

  Mutation: {
    sendOTP: async (_, { input }, { ipAddress, userAgent }) => {
      const { phoneNumber, countryCode, type } = input;
      logger.info('Sending OTP via Kaleyra', { phoneNumber, countryCode, type });
    
      // 1. User existence and type checks
      let user = await User.findOne({ where: { phoneNumber, countryCode } });
    
      if (user && type === "POST_GOOGLE_VERIFY") {
        throw new GraphQLError('Phone is already registered with another account', {
          extensions: { code: 'PHONE_CONFLICT' }
        });
      } else if (user && type === "PHONE_AUTH") {
        checkUserActiveOrThrow(user);
      }
    
      // 2. Rate limiting: max 5 OTPs per hour per phone+type
      const oneHourAgo = Date.now() - 60 * 60 * 1000
      const recentOTPs = await OTPVerification.count({
        where: {
          phoneNumber,
          countryCode,
          otpType: type,
          createdAt: { [Op.gte]: oneHourAgo }
        }
      });
      if (recentOTPs >= 5) {
        logger.warn('OTP rate limit exceeded', { phoneNumber, countryCode, type });
        throw new GraphQLError('Too many OTP requests. Please try again later.', {
          extensions: { code: 'OTP_RATE_LIMIT_EXCEEDED' }
        });
      }
    
      // 3. Prevent spamming: min 30s between requests
      const lastOTP = await OTPVerification.findOne({
        where: { phoneNumber, countryCode, otpType: type },
        order: [['createdAt', 'DESC']]
      });
      if (lastOTP && Date.now() - lastOTP.createdAt.getTime() < 30 * 1000) {
        throw new GraphQLError('Please wait before requesting another OTP.', {
          extensions: { code: 'OTP_TOO_SOON' }
        });
      }
    
      const transaction = await sequelize.transaction();
      try {
        // 4. Send OTP via Kaleyra
        const kaleyraSMSResult = await smsService.sendOTPSMS(phoneNumber, countryCode);
    
        if (!kaleyraSMSResult.success || !kaleyraSMSResult.verifyId) {
          throw new GraphQLError('Failed to initiate OTP with provider', {
            extensions: { code: 'OTP_PROVIDER_FAILED' }
          });
        }
    
        // 5. Expiry: 10 minutes
        const expiresAt = Date.now() + 10 * 60 * 1000
    
        // 6. Store OTP record
        await OTPVerification.create({
          phoneNumber,
          countryCode,
          otpType: type,
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
          maxAttempts: 5 // Set max attempts per OTP
        }, { transaction });
    
        await transaction.commit();
    
        logger.info('OTP sent successfully via Kaleyra', {
          phoneNumber,
          countryCode,
          verifyId: kaleyraSMSResult.verifyId,
          expiresAt,
          type
        });
    
        return {
          success: true,
          message: 'OTP sent successfully',
          retryAfter: 30, // 30s cooldown
        };
    
      } catch (error) {
        await transaction.rollback();
        logger.error('Failed to send OTP via Kaleyra', { phoneNumber, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to send OTP', { extensions: { code: 'SEND_OTP_FAILED' } });
      }
    },

    verifyOTP: async (_, { input }, { ipAddress, userAgent }) => {
      const { phoneNumber, countryCode, otp, deviceInfo, type, role } = input;
      logger.info('Verifying OTP via Kaleyra', { phoneNumber, countryCode, type });
    
      const transaction = await sequelize.transaction();
      try {
        // 1. Find latest, unexpired, unverified OTP
        const otpRecord = await OTPVerification.findOne({
          where: {
            phoneNumber,
            countryCode,
            otpType: type,
            isVerified: false,
            provider: 'KALEYRA',
            expiresAt: { [Op.gt]: new Date() }
          },
          order: [['createdAt', 'DESC']],
          lock: transaction.LOCK.UPDATE,
          transaction
        });
    
        if (!otpRecord || !otpRecord.verifyId) {
          logger.warn('No valid OTP record found', { phoneNumber, countryCode, type });
          throw new GraphQLError('Invalid or expired OTP session', {
            extensions: { code: 'INVALID_OTP_SESSION' }
          });
        }
    
        // 2. Attempt limit
        if (otpRecord.verificationAttempts >= otpRecord.maxAttempts) {
          logger.warn('Local OTP verification attempts exceeded', { phoneNumber });
          throw new GraphQLError('Maximum verification attempts exceeded', {
            extensions: { code: 'OTP_ATTEMPTS_EXCEEDED' }
          });
        }
    
        // 3. Verify OTP with Kaleyra
        let kaleyraVerifyResult;
        try {
          kaleyraVerifyResult = await smsService.verifyOTP(otpRecord.verifyId, otp);
        } catch (kaleyraError) {
          await otpRecord.increment('verificationAttempts', { transaction });
          throw kaleyraError;
        }
    
        // 4. Increment attempt counter
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
    
        // 5. Mark as verified
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
    
        // 6. User creation/login logic
        let user = await User.findOne({
          where: { phoneNumber, countryCode },
          lock: transaction.LOCK.UPDATE,
          transaction
        });
        if (user) checkUserActiveOrThrow(user);
    
        const isNewUser = !user;
        if (isNewUser) {
          user = await User.create({
            phoneNumber,
            countryCode,
            isPhoneVerified: true,
            onboardingStep: 'PROFILE_SETUP',
            role: role || 'USER'
          }, { transaction });
          logger.info('New user created via Kaleyra OTP', { userId: user.id });
        } else {
          logger.info('Existing user logged in via Kaleyra OTP', { userId: user.id });
        }
    
        // 7. Generate tokens
        const { accessToken, refreshToken } = await generateTokens(
          user.id,
          deviceInfo,
          user.role,
          transaction,
          ipAddress,
          userAgent
        );
    
        logger.info('Tokens issued after Kaleyra OTP verification', {
          userId: user.id,
          deviceId: deviceInfo?.deviceId,
          verifyId: otpRecord.verifyId
        });
    
        await transaction.commit();
    
        return {
          success: true,
          message: isNewUser ? 'Account created successfully' : 'Login successful',
          user,
          isNewUser,
          authTokens: { accessToken, refreshToken }
        };
    
      } catch (error) {
        await transaction.rollback();
        logger.error('OTP verification failed', { phoneNumber, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to verify OTP', { extensions: { code: 'VERIFY_OTP_FAILED' } });
      }
    },

    refreshToken: async (_, { refreshToken }, context) => {
      logger.info('Refreshing token');
      const transaction = await sequelize.transaction();
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const session = await AuthSession.findOne({
          where: {
            refreshTokenHash,
            isActive: true,
            refreshExpiresAt: { [Op.gt]: new Date() }
          },
          transaction
        });

        if (!session) {
          logger.warn('Invalid or expired refresh token session', { userId: decoded.userId });
          throw new GraphQLError('Invalid refresh token', { extensions: { code: 'UNAUTHENTICATED' } });
        }

        // Optionally: You can include `User` if needed and check if user isActive
        const user = await User.findOne({ where: { id: session.userId }, transaction });
        if (!user) {
          logger.warn('Refresh attempt for deactivated user', { userId: session.userId });
          throw new GraphQLError('User account is inactive', { extensions: { code: 'FORBIDDEN' } });
        }
        checkUserActiveOrThrow(user);

        const { accessToken, refreshToken: newRefreshToken, expiresAt } = await generateTokens(
          user.id,
          {
            deviceId: session.deviceId,
            deviceType: session.deviceType,
            deviceName: session.deviceName,
            appVersion: session.appVersion,
            osVersion: session.osVersion,
            fcmToken: session.fcmToken
          },
          user.role,
          transaction,
          context.ipAddress,
          context.userAgent
        );

        await session.update({
          accessTokenHash: crypto.createHash('sha256').update(accessToken).digest('hex'),
          refreshTokenHash: crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
          lastUsedAt: new Date()
        }, { transaction });

        await transaction.commit();

        logger.info('Token refreshed successfully', { userId: user.id, deviceId: session.deviceId });

        return {
          success: true,
          authTokens: {
            accessToken,
            refreshToken: newRefreshToken,
            expiresAt
          },
          message: 'Token refreshed successfully'
        };

      } catch (error) {
        await transaction.rollback();
        logger.error('Refresh token failed', { error: error });
        if (error instanceof GraphQLError) throw error
        throw new GraphQLError('Invalid refresh token', { extensions: { code: 'UNAUTHENTICATED' } });
      }
    },

    googleAuth: async (_, { input }, { ipAddress, userAgent }) => {
      const { idToken, deviceInfo } = input;
      logger.info('Google auth initiated');
      const transaction = await sequelize.transaction();
      try {
        if (!idToken) {
          logger.warn('Google auth failed: Missing idToken');
          throw new GraphQLError('Google idToken is required', {
            extensions: { code: "GOOGLE_AUTH_FAILED" }
          });
        }
    
        const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
        let payload;
        try {
          logger.info('Verifying Google idToken');
          const ticket = await oauth2Client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID
          });
          payload = ticket.getPayload();
        } catch (verifyError) {
          logger.error('Google token verification failed', {
            message: verifyError.message,
            name: verifyError.name,
          });
          throw new GraphQLError('Invalid or expired Google token', {
            extensions: { code: "GOOGLE_AUTH_FAILED" }
          });
        }
    
        if (!payload || !payload.sub || !payload.email) {
          logger.error('Google auth failed: Incomplete payload', {
            payloadKeys: Object.keys(payload || {})
          });
          throw new GraphQLError('Incomplete token payload from Google', {
            extensions: { code: "GOOGLE_AUTH_FAILED" }
          });
        }
    
        const { email, name } = payload;
        const googleId = payload.sub;
    
        // Find user by googleId or fallback to email
        let user = await User.findOne({ where: { googleId }, transaction });
        let isNewUser = false;
    
        if (!user) {
          user = await User.findOne({ where: { email }, transaction });
        }
        if (user) checkUserActiveOrThrow(user);
    
        if (!user) {
          user = await User.create({
            googleId,
            email,
            name: name || email,
            isEmailVerified: true,
            onboardingStep: 'PHONE_VERIFICATION',
            isProfileComplete: false,
            isActive: true
          }, { transaction });
    
          isNewUser = true;
    
          logger.info('New user created via Google Auth', { userId: user.id });
    
          const phoneVerificationToken = jwt.sign(
            { userId: user.id, type: 'phone_verification' },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '15m' }
          );
    
          await transaction.commit();
    
          return {
            success: true,
            user,
            isNewUser,
            onboardingStep: user.onboardingStep,
            authTokens: null,
            phoneVerificationToken,
            message: 'Phone verification required. Please verify your phone number to continue.'
          };
        } else {
          if (!user.googleId) {
            await user.update({ googleId }, { transaction });
          }
    
          if (!user.isPhoneVerified || !user.phoneNumber) {
            logger.info('Existing Google user requires phone verification', { userId: user.id });
    
            const phoneVerificationToken = jwt.sign(
              { userId: user.id, type: 'phone_verification' },
              process.env.ACCESS_TOKEN_SECRET,
              { expiresIn: '15m' }
            );
    
            await transaction.commit();
    
            return {
              success: true,
              user,
              isNewUser: false,
              onboardingStep: 'PHONE_VERIFICATION',
              authTokens: null,
              phoneVerificationToken,
              message: 'Phone verification required. Please verify your phone number to continue.'
            };
          }
    
          logger.info('Existing user logged in via Google Auth', { userId: user.id });
        }
    
        const { accessToken, refreshToken, expiresAt } = await generateTokens(
          user.id, deviceInfo, user.role, transaction, ipAddress, userAgent
        );
    
        await transaction.commit();
    
        logger.info('Tokens issued after Google Auth', { userId: user.id, deviceId: deviceInfo.deviceId });
    
        return {
          success: true,
          user,
          isNewUser,
          onboardingStep: user.onboardingStep,
          authTokens: { accessToken, refreshToken, expiresAt },
          phoneVerificationToken: null,
          message: isNewUser ? 'Account created via Google' : 'Login successful'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Google Auth failed', { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Google authentication failed', {
          extensions: { code: 'GOOGLE_AUTH_FAILED' }
        });
      }
    },

    logout: requireAuth(async (
      _,
      { deviceId: deviceIdFromFrontend, allDevices = false },
      { user, deviceId: currentDeviceId }
    ) => {
      const transaction = await sequelize.transaction();
      try {
        let whereClause = {
          userId: user.id,
          isActive: true
        };

        if (allDevices) {
          // Logout from all devices EXCEPT the current one
          whereClause.deviceId = { [Op.ne]: currentDeviceId };
        } else if (deviceIdFromFrontend) {
          // ✅ Securely verify ownership of the requested device
          const sessionToLogout = await AuthSession.findOne({
            where: {
              userId: user.id,
              deviceId: deviceIdFromFrontend,
              isActive: true
            },
            transaction
          });

          if (!sessionToLogout) {
            logger.warn('Invalid logout request: device not found or not owned by user', {
              userId: user.id,
              deviceIdFromFrontend
            });
            throw new GraphQLError('Device not found or unauthorized', {
              extensions: { code: 'UNAUTHORIZED_DEVICE_LOGOUT' }
            });
          }

          whereClause.deviceId = deviceIdFromFrontend;
        } else {
          // Default: Logout current device
          whereClause.deviceId = currentDeviceId;
        }

        const [updatedCount] = await AuthSession.update(
          { isActive: false },
          { where: whereClause, transaction }
        );

        if (updatedCount === 0) {
          throw new GraphQLError('No active session found for logout', {
            extensions: { code: 'SESSION_NOT_FOUND' }
          });
        }

        await transaction.commit();

        logger.info('Logout successful', {
          userId: user.id,
          currentDeviceId,
          deviceIdFromFrontend,
          allDevices
        });

        return {
          success: true,
          message: allDevices
            ? 'Logged out from all other devices'
            : deviceIdFromFrontend
              ? 'Logged out from selected device'
              : 'Logged out from current device'
        };
      } catch (error) {
        await transaction.rollback();

        logger.error('Logout failed', {
          userId: user.id,
          currentDeviceId,
          deviceIdFromFrontend,
          allDevices,
          error: error.message
        });
        if (error instanceof GraphQLError) throw error
        throw new GraphQLError('Logout failed. Please try again.', {
          extensions: { code: 'LOGOUT_FAILED' }
        });
      }
    }),

    verifyGooglePhoneOTP: requireAuth(async (_, { input }, context) => {
      const { phoneNumber, countryCode, otp, deviceInfo, type } = input;
      logger.info('Verifying Google onboarding OTP', { phoneNumber, countryCode, type, userId: context.user?.id });
      if (!context.user || context.user.onboardingStep !== 'PHONE_VERIFICATION') {
        throw new GraphQLError('Not authorized for Google phone verification', { extensions: { code: 'UNAUTHORIZED' } });
      }

      const transaction = await sequelize.transaction();
      try {

        // Find the most recent OTP record for this phone number and type
        const otpRecord = await OTPVerification.findOne({
          where: {
            phoneNumber,
            countryCode,
            otpType: type,
            isVerified: false,
            provider: 'KALEYRA',
            expiresAt: { [Op.gt]: new Date() }
          },
          order: [['createdAt', 'DESC']],
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        if (!otpRecord || !otpRecord.verifyId) {
          logger.warn('No valid OTP record found', { phoneNumber, countryCode, type });
          throw new GraphQLError('Invalid or expired OTP session', {
            extensions: { code: 'INVALID_OTP_SESSION' }
          });
        }

        // Check local attempt limits (Kaleyra also has its own limits)
        if (otpRecord.verificationAttempts >= otpRecord.maxAttempts) {
          logger.warn('Local OTP verification attempts exceeded', { phoneNumber });
          throw new GraphQLError('Maximum verification attempts exceeded', {
            extensions: { code: 'OTP_ATTEMPTS_EXCEEDED' }
          });
        }

        // Verify OTP with Kaleyra
        let kaleraVerifyResult;
        try {
          kaleraVerifyResult = await smsService.verifyOTP(otpRecord.verifyId, otp);
        } catch (kaleraError) {
          // Increment attempt counter for provider errors too
          await otpRecord.increment('verificationAttempts', { transaction });
          throw kaleraError;
        }

        // Increment attempt counter regardless of result
        await otpRecord.increment('verificationAttempts', { transaction });

        if (!kaleraVerifyResult.success || !kaleraVerifyResult.isValid) {
          // Update provider status
          await otpRecord.update({
            providerStatus: kaleraVerifyResult.status || 'failed',
            providerResponse: {
              ...otpRecord.providerResponse,
              lastVerifyAttempt: {
                result: kaleraVerifyResult,
                attemptedAt: new Date()
              }
            }
          }, { transaction });

          logger.warn('OTP verification failed with Kaleyra', {
            phoneNumber,
            verifyId: otpRecord.verifyId,
            status: kaleraVerifyResult.status
          });

          throw new GraphQLError(kaleraVerifyResult.message || 'Invalid OTP', {
            extensions: { code: 'INVALID_OTP' }
          });
        }

        // Mark as verified
        await otpRecord.update({
          isVerified: true,
          verifiedAt: new Date(),
          providerStatus: kaleraVerifyResult.status || 'approved',
          providerResponse: {
            ...otpRecord.providerResponse,
            verificationResult: {
              result: kaleraVerifyResult,
              verifiedAt: new Date()
            }
          }
        }, { transaction });

        // Update user
        const user = await User.findByPk(context.user.id, { transaction });
        if (!user) {
          throw new GraphQLError('Authenticated user not found during OTP verification', { extensions: { code: 'USER_NOT_FOUND' } });
        }
        await user.update({
          phoneNumber,
          countryCode,
          isPhoneVerified: true,
          onboardingStep: 'PROFILE_SETUP',
          isProfileComplete: false
        }, { transaction });
        logger.info('Google onboarding: phone verified and user updated', { userId: user.id });
        const { accessToken, refreshToken, expiresAt } = await generateTokens(user.id, deviceInfo, user.role, transaction, context.ipAddress, context.userAgent);
        await transaction.commit();
        return {
          success: true,
          user,
          isNewUser: false,
          onboardingStep: user.onboardingStep,
          authTokens: { accessToken, refreshToken, expiresAt },
          message: 'Phone number verified successfully. Onboarding has advanced to the next step.'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Google onboarding OTP verification failed', { phoneNumber, error });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to verify Google onboarding OTP', { extensions: { code: 'VERIFY_GOOGLE_OTP_FAILED' } });
      }
    })
  }
};

async function generateTokens(userId, deviceInfo, role, transaction, ipAddress, userAgent) {
  const accessToken = jwt.sign(
    { userId, deviceId: deviceInfo.deviceId, role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || '1h' }
  );

  const refreshToken = jwt.sign(
    { userId, deviceId: deviceInfo.deviceId, role },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '30d' }
  );

  const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const tokenExpiresAt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await AuthSession.destroy({
    where: { userId, deviceId: deviceInfo.deviceId },
    transaction
  });

  await AuthSession.create({
    userId,
    accessTokenHash,
    refreshTokenHash,
    tokenExpiresAt,
    refreshExpiresAt,
    deviceId: deviceInfo.deviceId,
    deviceType: deviceInfo.deviceType,
    deviceName: deviceInfo.deviceName,
    appVersion: deviceInfo.appVersion,
    osVersion: deviceInfo.osVersion,
    fcmToken: deviceInfo.fcmToken,
    ipAddress,
    userAgent
  }, { transaction });

  logger.info('Auth session created', { userId, deviceId: deviceInfo.deviceId });

  return { accessToken, refreshToken, expiresAt: tokenExpiresAt };
}

function checkUserActiveOrThrow(user) {
  if (!user.isActive && user.deletedAt) {
    throw new GraphQLError(
      'Account is scheduled for deletion. Please contact support to restore.',
      { extensions: { code: 'ACCOUNT_SCHEDULED_FOR_DELETION', deletedAt: user.deletedAt } }
    );
  }
  if (!user.isActive) {
    throw new GraphQLError(
      'Account is deactivated. Please contact support.',
      { extensions: { code: 'ACCOUNT_DEACTIVATED' } }
    );
  }
}

module.exports = authResolvers;

