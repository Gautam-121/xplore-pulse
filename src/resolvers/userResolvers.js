const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');
const db = require("../config/dbConfig")
const UserModel = db.User
const AuthSession = db.AuthSession;
const InterestModel = db.Interest
const UserInterestModel = db.UserInterest
const sequelize = db.sequelize
const fileUploadService = require("../services/fileUploadService")
const { requireAuth } = require('../middleware/auth');
const crypto = require("crypto")
const { Op } = require("sequelize")
const { sendEmailOTP, verifyEmailOTP } = require('../services/emailVerificationService');
const smsService = require('../services/kaleraSmsService');


function hashOTP(otp, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(otp).digest('hex');
  return { hash, salt };
}


const userResolvers = {
  Query: {
    currentUser: requireAuth(async (_, __, { user }) => {
      logger.info('Fetching current user', { userId: user.id });
      try {    
        const currentUser = await UserModel.findByPk(user.id, {
          include: [{ model: InterestModel, as: 'interests', through: { attributes: [] } }]
        });
    
        if (!currentUser) {
          logger.warn('User not found during currentUser query', { userId: user.id });
          throw new GraphQLError('User not found', { extensions: { code: 'USER_NOT_FOUND' } });
        }
    
        logger.info('Fetched current user with interests', { userId: user.id });
        return currentUser;
    
      } catch (error) {
        logger.error('failed to fetched current user', {
          userId: user.id,
          error: error.message
        });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to fetched current user', {
          extensions: { code: 'CURRENT_USER_FAILED' }
        });
      }
    })
  },

  Mutation: {
    completeProfileSetup: requireAuth(async (_, { input }, { user, ipAddress, userAgent }) => {
      const transaction = await sequelize.transaction();
      let uploadedFileUrl = null;
      try {
        const { name, bio, profileImage, email } = input;
        logger.info('Starting profile setup', { userId: user.id });

        // Email uniqueness check
        if (email) {
          const existing = await UserModel.findOne({ where: { email }, transaction });
          if (existing && existing.id !== user.id) {
            throw new GraphQLError('Email already in use in another account', {
              extensions: { code: 'EMAIL_IN_USE' }
            });
          }
        }

        const updateData = { name, bio };
        if (email) updateData.email = email;

        // Profile image logic (as before)
        if (profileImage) {
          fileUploadService.validateImageFile(profileImage.file);
          try {
            const fileUrl = await fileUploadService.uploadFile(profileImage.file, 'profile-images');
            updateData.profileImageUrl = fileUrl;
            uploadedFileUrl = fileUrl;
            logger.info('Profile image uploaded', { userId: user.id });
          } catch (error) {
            logger.error('Profile image upload failed', { userId: user.id, error: error.message });
            throw new GraphQLError('Failed to upload profile image', {
              extensions: { code: 'BAD_USER_INPUT' }
            });
          }
        }

        const userRecord = await UserModel.findByPk(user.id, { transaction });
        if (!userRecord) {
          throw new GraphQLError('User not found', {
            extensions: { code: 'USER_NOT_FOUND' }
          });
        }

        // If email provided, do not advance onboarding step until verified
        await userRecord.update({
          ...updateData,
          isProfileComplete: true,
          onboardingStep: email ? 'PROFILE_SETUP' : 'INTERESTS_SELECTION',
        }, { transaction });

        // If email provided, send OTP
        if (email) {
          await sendEmailOTP(user.id, email, ipAddress, userAgent);
          logger.info('Sent email verification OTP', { userId: user.id, email });
        }

        await transaction.commit();

        logger.info('Profile setup completed', { userId: user.id });

        return {
          success: true,
          user: userRecord,
          message: email
            ? 'Profile setup completed. Please verify your email.'
            : 'Profile setup completed'
        };

      } catch (error) {
        await transaction.rollback();
        if (uploadedFileUrl) {
          try {
            await fileUploadService.deleteFile(uploadedFileUrl);
          } catch (cleanupError) {
            logger.warn('Rollback: failed to delete uploaded file', {
              fileUrl: uploadedFileUrl,
              error: cleanupError.message
            });
          }
        }
        console.log("error", error)
        logger.error('Profile setup failed', { userId: user.id, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Profile completion failed', {
          extensions: { code: 'PROFILE_SETUP_FAILED' }
        });
      }
    }),

    // Step 1: Request email change (sends OTP)
    requestEmailUpdate: requireAuth(async (_, { email }, { user, req }) => {
      logger.info('Starting email update request', { userId: user.id, email });
      try {
        const existingUser = await UserModel.findByPk(user.id);
        
        if (!existingUser) {
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }

        if (existingUser.onboardingStep !== "COMPLETED") {
          throw new GraphQLError("Please complete the onboarding step", {
            extensions: { code: "ONBOARDING_NOT_COMPLETED" }
          });
        }

        // Use the existing sendEmailOTP service which handles all validations
        const result = await sendEmailOTP(
          user.id, 
          email, 
          req.ip, 
          req.get('User-Agent')
        );

        logger.info('Email update OTP sent successfully', {
          userId: user.id,
          email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3') // Mask email for logs
        });

        return {
          success: true,
          message: result.message || 'OTP sent to your email. Please verify to update your email address.',
          retryAfter: result.retryAfter
        };
      } catch (error) {
        logger.error('Error in email update request', {
          userId: user.id,
          email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3'),
          error: error.message,
          code: error.extensions?.code
        });
        
        // Re-throw GraphQLError as-is, wrap others
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to send email verification', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    // Step 2: Verify email OTP and update email
    verifyAndUpdateEmail: requireAuth(async (_, { email, otp }, { user }) => {
      logger.info('Starting email verification and update', { userId: user.id, email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3') });
      const transaction = await sequelize.transaction();
      try {
        // Find the most recent unverified OTP for this user and email
        const otpVerification = await db.OtpVerification.findOne({
          where: {
            userId: user.id,
            email: email,
            otpType: 'EMAIL_VERIFY',
            isVerified: false
          },
          order: [['createdAt', 'DESC']],
          transaction
        });
        
        if (!otpVerification) {
          throw new GraphQLError('No pending verification found for this email', {
            extensions: { code: 'NO_PENDING_VERIFICATION' }
          });
        }

        console.log("otpVer" , otpVerification)

        if (otpVerification.expiresAt < new Date()) {
          throw new GraphQLError('OTP has expired', {
            extensions: { code: 'OTP_EXPIRED' }
          });
        }

        if ((otpVerification.verificationAttempts + 1) >= otpVerification.maxAttempts) {
          throw new GraphQLError('Maximum verification attempts exceeded', {
            extensions: { code: 'MAX_ATTEMPTS_EXCEEDED' }
          });
        }

        // Verify OTP
        const { hash:hashedOTP } = hashOTP(otp, otpVerification.otpSalt);
        if (hashedOTP !== otpVerification.otpHash) {
          // Increment attempts
          await otpVerification.update({
            verificationAttempts: otpVerification.verificationAttempts + 1
          });
          const remainingAttempts = otpVerification.maxAttempts - (otpVerification.verificationAttempts);
          console.log("Error" , otpVerification.verificationAttempts)
          throw new GraphQLError(`Invalid OTP. ${remainingAttempts} attempts remaining.`, {
            extensions: { 
              code: 'INVALID_OTP',
              remainingAttempts
            }
          });
        }

        // Double-check email is still not in use by another user
        const emailExists = await UserModel.findOne({
          where: { 
            email: email,
            id: { [Op.ne]: user.id }
          },
          transaction
        });
        
        if (emailExists) {
          throw new GraphQLError('Email already in use by another account', {
            extensions: { code: 'EMAIL_IN_USE' }
          });
        }

        // Update user email
        const existingUser = await UserModel.findByPk(user.id, { transaction });
        const previousEmail = existingUser.email;
        
        await existingUser.update({
          email: email,
          ...(existingUser.googleId && { googleId: null}),
          isEmailVerified: true
        }, { transaction });

        // Mark OTP as verified
        await otpVerification.update({
          isVerified: true,
          verifiedAt: new Date()
        }, { transaction });

        // Clean up any other pending email verifications for this user
        await db.OtpVerification.update({
          isVerified: false,
          verifiedAt: new Date()
        }, {
          where: {
            userId: user.id,
            otpType: 'EMAIL_VERIFY',
            isVerified: false,
            id: { [Op.ne]: otpVerification.id }
          },
          transaction
        });

        await transaction.commit();

        logger.info('Email updated successfully', {
          userId: user.id,
          previousEmail: previousEmail?.replace(/(.{2})(.*)(@.*)/, '$1****$3'),
          newEmail: email.replace(/(.{2})(.*)(@.*)/, '$1****$3')
        });

        return {
          success: true,
          user: existingUser,
          message: 'Email updated successfully'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error in email verification and update', {
          userId: user.id,
          email: email.replace(/(.{2})(.*)(@.*)/, '$1****$3'),
          error: error.message,
          code: error.extensions?.code
        });
        
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to verify and update email', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    // Step 1: Request phone change (sends OTP)
    requestPhoneUpdate: requireAuth(async (_, { phoneNumber, countryCode }, { user, ipAddress,userAgent, req }) => {
      logger.info('Starting phone update request', { userId: user.id, phoneNumber, countryCode });
      
      const transaction = await sequelize.transaction();
      
      try {
        const existingUser = await UserModel.findByPk(user.id, { transaction });
        
        if (!existingUser) {
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }

        if (existingUser.onboardingStep !== "COMPLETED") {
          throw new GraphQLError("Please complete the onboarding step", {
            extensions: { code: "ONBOARDING_NOT_COMPLETED" }
          });
        }

        // Check if phone is already in use
        const phoneExists = await UserModel.findOne({
          where: { phoneNumber, countryCode },
          transaction
        });
        
        if (phoneExists && phoneExists.id !== user.id) {
          throw new GraphQLError('Phone number already in use by another account', {
            extensions: { code: 'PHONE_IN_USE' }
          });
        }

        if(phoneExists && phoneExists.countryCode === countryCode && phoneExists.phone === phoneNumber){
          throw new GraphQLError("Phone is already verified", {
            extensions: { code : "PHONE_VERIFIED"}
          })
        }

         // 2. Rate limiting: max 5 OTPs per hour per phone+type
      const oneHourAgo = Date.now() - 60 * 60 * 1000
      const recentOTPs = await db.OtpVerification.count({
        where: {
          phoneNumber,
          countryCode,
          otpType: 'PHONE_AUTH',
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
      const lastOTP = await db.OtpVerification.findOne({
        where: { phoneNumber, countryCode, otpType: 'PHONE_AUTH' },
        order: [['createdAt', 'DESC']]
      });
      if (lastOTP && Date.now() - lastOTP.createdAt.getTime() < 30 * 1000) {
        throw new GraphQLError('Please wait before requesting another OTP.', {
          extensions: { code: 'OTP_TOO_SOON' }
        });
      }


        // Send OTP via Kaleyra (this should set the verifyId)
        const kaleyraSMSResult = await smsService.sendOTPSMS(phoneNumber, countryCode);

        if (!kaleyraSMSResult.success || !kaleyraSMSResult.verifyId) {
          throw new GraphQLError('Failed to initiate OTP with provider', {
            extensions: { code: 'OTP_PROVIDER_FAILED' }
          });
        }

        // 5. Expiry: 10 minutes
        const expiresAt = Date.now() + 10 * 60 * 1000
        
        // 6. Store OTP record
        await db.OtpVerification.create({
          phoneNumber,
          countryCode,
          otpType: "PHONE_AUTH",
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

        logger.info('Phone update OTP sent successfully', {
          userId: user.id,
          phoneNumber,
          countryCode,
        });

        return {
          success: true,
          message: 'OTP sent to your phone. Please verify to update your phone number.',
          retryAfter: 30
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error in phone update request', {
          userId: user.id,
          phoneNumber,
          countryCode,
          error: error.message
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to send phone verification', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    // Step 2: Verify phone OTP and update phone
    verifyAndUpdatePhone: requireAuth(async (_, { phoneNumber, countryCode, otp }, { user }) => {
      logger.info('Starting phone verification and update', { userId: user.id, phoneNumber , countryCode });
      
      const transaction = await sequelize.transaction();
      
      try {
        // 1. Find latest, unexpired, unverified OTP
        const otpRecord = await db.OtpVerification.findOne({
          where: {
            phoneNumber,
            countryCode,
            otpType: "PHONE_AUTH",
            isVerified: false,
            provider: 'KALEYRA',
          },
          order: [['createdAt', 'DESC']],
          lock: transaction.LOCK.UPDATE,
          transaction
        });
    
        if (!otpRecord || !otpRecord.verifyId) {
          logger.warn('No valid OTP record found', { phoneNumber, countryCode, type });
          throw new GraphQLError('No pending verification found for this PHONE', {
            extensions: { code: 'INVALID_OTP_SESSION' }
          });
        }

        if (otpRecord.expiresAt < new Date()) {
          throw new GraphQLError('OTP has expired', {
            extensions: { code: 'OTP_EXPIRED' }
          });
        }
    
        // 2. Attempt limit
        if ((otpRecord.verificationAttempts + 1) >= otpRecord.maxAttempts) {
          logger.warn('Local OTP verification attempts exceeded', { phoneNumber });
          throw new GraphQLError('Maximum verification attempts exceeded', {
            extensions: { code: 'OTP_ATTEMPTS_EXCEEDED' }
          });
        }

         // 3. Verify OTP with KaleyraverifyAndUpdatePhone: requireAuth(async (_, { phoneNumber, countryCode, otp }, { user }) => {
      logger.info('Starting phone verification and update', { userId: user.id, phoneNumber , countryCode });
      
      const transaction = await sequelize.transaction();
      
      try {
        // 1. Find latest, unexpired, unverified OTP
        const otpRecord = await db.OtpVerification.findOne({
          where: {
            phoneNumber,
            countryCode,
            otpType: "PHONE_AUTH",
            isVerified: false,
            provider: 'KALEYRA',
          },
          order: [['createdAt', 'DESC']],
          lock: transaction.LOCK.UPDATE,
          transaction
        });
    
        if (!otpRecord || !otpRecord.verifyId) {
          logger.warn('No valid OTP record found', { phoneNumber, countryCode, type });
          throw new GraphQLError('No pending verification found for this PHONE', {
            extensions: { code: 'INVALID_OTP_SESSION' }
          });
        }

        if (otpRecord.expiresAt < new Date()) {
          throw new GraphQLError('OTP has expired', {
            extensions: { code: 'OTP_EXPIRED' }
          });
        }
    
        // 2. Attempt limit
        if ((otpRecord.verificationAttempts + 1) >= otpRecord.maxAttempts) {
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

         console.log("KaleraResult", kaleyraVerifyResult)
        
        if (!kaleyraVerifyResult.success || !kaleyraVerifyResult.isValid) {
          // Increment attempts
          await db.OtpVerification.update({
            providerStatus: kaleyraVerifyResult.status || 'failed',
            providerResponse: {
              ...otpRecord.providerResponse,
              lastVerifyAttempt: {
                result: kaleyraVerifyResult,
                attemptedAt: new Date()
              }
            },
            verificationAttempts: otpRecord.verificationAttempts + 1
          }, { transaction });

          logger.warn('OTP verification failed with Kaleyra', {
            phoneNumber,
            status: kaleyraVerifyResult.status
          });
          
          throw new GraphQLError(kaleyraVerifyResult.message || 'Invalid OTP', {
            extensions: { code: 'INVALID_OTP' }
          });
        }

        // Update user phone
        const existingUser = await UserModel.findByPk(user.id, { transaction });
        await existingUser.update({
          phoneNumber: otpRecord.phoneNumber,
          countryCode: otpRecord.countryCode,
          isPhoneVerified: true
        }, { transaction });

        // Mark OTP as verified
        await db.OtpVerification.update({
          isVerified: true,
          verifiedAt: new Date(),
          providerResponse: kaleyraVerifyResult.status || 'approved',
          providerResponse: {
            ...otpRecord.providerResponse,
            verificationResult: {
              result: kaleyraVerifyResult,
              verifiedAt: new Date()
            }
          }
        }, { transaction });

        await transaction.commit();

        logger.info('Phone updated successfully', {
          userId: user.id,
          newPhone: otpRecord.phoneNumber,
          countryCode: otpRecord.countryCode
        });

        return {
          success: true,
          user: existingUser,
          message: 'Phone number updated successfully'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error in phone verification and update', {
          userId: user.id,
          error: error.message
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to verify and update phone', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    })
         let kaleyraVerifyResult;
         try {
           kaleyraVerifyResult = await smsService.verifyOTP(otpRecord.verifyId, otp);
         } catch (kaleyraError) {
           await otpRecord.increment('verificationAttempts', { transaction });
           throw kaleyraError;
         }

         console.log("KaleraResult", kaleyraVerifyResult)
        
        if (!kaleyraVerifyResult.success || !kaleyraVerifyResult.isValid) {
          // Increment attempts
          await otpRecord.update({
            providerStatus: kaleyraVerifyResult.status || 'failed',
            providerResponse: {
              ...otpRecord.providerResponse,
              lastVerifyAttempt: {
                result: kaleyraVerifyResult,
                attemptedAt: new Date()
              }
            },
            verificationAttempts: otpRecord.verificationAttempts + 1
          }, { transaction });

          logger.warn('OTP verification failed with Kaleyra', {
            phoneNumber,
            status: kaleyraVerifyResult.status
          });
          
          throw new GraphQLError(kaleyraVerifyResult.message || 'Invalid OTP', {
            extensions: { code: 'INVALID_OTP' }
          });
        }

        // Update user phone
        const existingUser = await UserModel.findByPk(user.id, { transaction });
        await existingUser.update({
          phoneNumber: otpRecord.phoneNumber,
          countryCode: otpRecord.countryCode,
          isPhoneVerified: true
        }, { transaction });

        // Mark OTP as verified
        await otpRecord.update({
          isVerified: true,
          verifiedAt: new Date(),
          providerResponse: kaleyraVerifyResult.status || 'approved',
          providerResponse: {
            ...otpRecord.providerResponse,
            verificationResult: {
              result: kaleyraVerifyResult,
              verifiedAt: new Date()
            }
          }
        }, { transaction });

        await transaction.commit();

        logger.info('Phone updated successfully', {
          userId: user.id,
          newPhone: otpRecord.phoneNumber,
          countryCode: otpRecord.countryCode
        });

        return {
          success: true,
          user: existingUser,
          message: 'Phone number updated successfully'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error in phone verification and update', {
          userId: user.id,
          error: error.message
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to verify and update phone', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    resendEmailOTP: requireAuth(async (_, { email }, { user, ipAddress, userAgent }) => {
      try {
        // Optionally, check if the user's email matches the one on file
        if (user.email !== email) {
          throw new GraphQLError('You can only resend OTP to your own email.', {
            extensions: { code: 'EMAIL_MISMATCH' }
          });
        }
        await sendEmailOTP(user.id, email, ipAddress, userAgent);
        return {
          success: true,
          message: 'Verification code resent to your email.'
        };
      } catch (error) {
        logger.error('Resend email otp failed', { userId: user.id, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Resend email otp failed', {
          extensions: { code: 'RESEND_EMAIL_OTP_FAILED' }
        });
      }
    }),

    verifyEmailOTP: requireAuth(async (_, { email, otp }, { user }) => {
      try {
        // Optionally, check if the user's email matches the one on file
        if (user.email !== email) {
          throw new GraphQLError('Provide your own email', {
            extensions: { code: 'EMAIL_MISMATCH' }
          });
        }
        return await verifyEmailOTP(user.id, email, otp);
      } catch (error) {
        logger.error('Verify email otp failed', { userId: user.id, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Veridy email otp failed', {
          extensions: { code: 'VERIFY_EMAIL_OTP' }
        });
      }
    }),

    selectInterests: requireAuth(async (_, { interestIds }, { user }) => {
      logger.info('Selecting interests', { userId: user.id, interestIds });
      const transaction = await sequelize.transaction();
      try {
        // Edge case: No interests provided
        if (!Array.isArray(interestIds) || interestIds.length === 0) {
          throw new GraphQLError('Please select at least one interest', {
            extensions: { code: 'BAD_USER_INPUT', argumentName: 'interestIds' }
          });
        }

        // Edge case: Duplicate IDs in input
        const uniqueInterestIds = [...new Set(interestIds)];
        if (uniqueInterestIds.length !== interestIds.length) {
          logger.warn('Duplicate interest IDs provided', { userId: user.id, interestIds });
          throw new GraphQLError('Duplicate interest IDs are not allowed', {
            extensions: { code: 'BAD_USER_INPUT', argumentName: 'interestIds' }
          });
        }

        // Fetch interests from DB
        const interests = await InterestModel.findAll({
          where: { id: interestIds, isActive: true },
          transaction
        });

        // Edge case: Some IDs not found in DB
        if (interests.length !== interestIds.length) {
          // Find which IDs are missing
          const foundIds = interests.map(i => i.id);
          const missingIds = interestIds.filter(id => !foundIds.includes(id));
          logger.warn('Some interest IDs not found in DB', { userId: user.id, missingIds });
          throw new GraphQLError(
            `Some interests are invalid or not found`,
            {
              extensions: { code: 'BAD_USER_INPUT', argumentName: 'interestIds', missingIds }
            }
          );
        }

        // Get existing interests of the user
        const oldInterests = await UserInterestModel.findAll({
          where: { userId: user.id },
          attributes: ['interestId'],
          raw: true,
          transaction
        });
        const oldInterestIds = oldInterests.map(i => i.interestId);

        // Remove old links
        await UserInterestModel.destroy({
          where: { userId: user.id },
          transaction
        });

        // Insert new links
        const userInterests = interestIds.map((interestId, index) => ({
          userId: user.id,
          interestId,
          priorityOrder: index
        }));
        await UserInterestModel.bulkCreate(userInterests, { transaction });

        // Update followersCount in bulk
        const toDecrement = oldInterestIds.filter(id => !interestIds.includes(id));
        const toIncrement = interestIds.filter(id => !oldInterestIds.includes(id));

        if (toIncrement.length > 0) {
          await InterestModel.increment('followersCount', {
            by: 1,
            where: { id: toIncrement },
            transaction
          });
        }

        if (toDecrement.length > 0) {
          await InterestModel.decrement('followersCount', {
            by: 1,
            where: { id: toDecrement },
            transaction
          });
        }

        const updatedUser = await UserModel.findByPk(user.id, {
          include: [{ model: InterestModel, as: 'interests', through: { attributes: [] } }],
          transaction
        });

        await updatedUser.update({ onboardingStep: 'COMMUNITY_RECOMMENDATIONS' }, { transaction });

        await transaction.commit();

        logger.info('Interests selected', { userId: user.id });

        return {
          success: true,
          user: updatedUser,
          recommendedCommunities: [], // TODO: Add actual logic
          message: 'Interests selected successfully'
        };

      } catch (error) {
        await transaction.rollback();
        logger.error('Interest selection failed', { userId: user.id, error: error.message });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to select interest', {
          extensions: { code: 'SELECT_INTEREST_FAILED' }
        });
      }
    }),

    updateOnboardingStep: requireAuth(async (_, { step }, { user }) => {    
      if (!['PHONE_VERIFICATION', 'PROFILE_SETUP' , 'INTERESTS_SELECTION', 'COMMUNITY_RECOMMENDATIONS', 'COMPLETED'].includes(step)) {
        logger.warn('Invalid onboarding step received', { userId: user.id, step });
        throw new GraphQLError(`Invalid onboarding step: ${step}`, {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }
      logger.info('Attempting to update onboarding step', { userId: user.id, step });
      try {
        const updatedUser = await UserModel.findByPk(user.id);
    
        if (!updatedUser) {
          logger.error('User not found during onboarding update', { userId: user.id });
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }
    
        await updatedUser.update({
          onboardingStep: step,
          onboardingCompletedAt: step === 'COMPLETED' ? new Date() : null
        });
        logger.info('Onboarding step updated successfully', { userId: user.id, step });
        return {
          success: true,
          user: updatedUser,
          message: 'Onboarding step updated'
        };
      } catch (error) {
        logger.error('Failed to update onboarding step', {
          userId: user.id,
          step,
          error: error.message,
          stack: error.stack
        });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to update onboarding step', {
          extensions: {
            code: 'INTERNAL_SERVER_ERROR',
          }
        });
      }
    }),

    updateUserProfile: requireAuth(async (_, { input }, { user }) => {
      logger.info('Starting profile update', { userId: user.id });
      const { name, bio, profileImage, removeProfileImage  } = input;
      try {
        const existingUser = await UserModel.findByPk(user.id);
    
        if (!existingUser) {
          logger.error('User not found during profile update', { userId: user.id });
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }

        if(existingUser.onboardingStep !== "COMPLETED"){
          throw new GraphQLError(
            "Please Complete the onboarding step", {
              extensions: { code: "ONBOARDING_NOT_COMPLETED"}
            }
          )
        }

    
        const updateData = {};
    
        if (name !== undefined) updateData.name = name;
        if (bio !== undefined) updateData.bio = bio;
    
        // Handle image deletion
        if (removeProfileImage === true && existingUser.profileImageUrl) {
          try {
            await fileUploadService.deleteFile(existingUser.profileImageUrl);
            logger.info('Existing profile image deleted from CDN', {
              userId: user.id,
              imageUrl: existingUser.profileImageUrl
            });
            updateData.profileImageUrl = null;
          } catch (deleteErr) {
            logger.error('Failed to delete existing profile image', {
              userId: user.id,
              imageUrl: existingUser.profileImageUrl,
              error: deleteErr.message,
              stack: deleteErr.stack
            });
            if(!profileImage?.file) throw deleteErr
          }
        }

        // Handle new profile image upload
        if (profileImage) {
          try {
            // Validate image
            fileUploadService.validateImageFile(profileImage.file);
            // Delete old image if exists
            if (existingUser.profileImageUrl) {
              try {
                await fileUploadService.deleteFile(existingUser.profileImageUrl);
                logger.info('Previous profile image deleted before new upload', {
                  userId: user.id,
                  oldImageUrl: existingUser.profileImageUrl
                });
              } catch (deleteErr) {
                logger.warn('Failed to delete old image before upload', {
                  userId: user.id,
                  oldImageUrl: existingUser.profileImageUrl,
                  error: deleteErr.message
                });
                // Not critical enough to block upload — continue
              }
            }
    
            const imageUrl = await fileUploadService.uploadFile(profileImage.file, 'profile-images');
            updateData.profileImageUrl = imageUrl;
            logger.info('New profile image uploaded', {
              userId: user.id,
              imageUrl
            });
          } catch (uploadErr) {
            logger.error('Failed to upload new profile image', {
              userId: user.id,
              error: uploadErr.message,
              stack: uploadErr.stack
            });
            throw new GraphQLError('Failed to upload profile image', {
              extensions: {
                code: 'FILE_UPLOAD_FAILED',
              }
            });
          }
        }
    
        // Apply updates to the user
        await existingUser.update(updateData);
    
        logger.info('User profile updated successfully', {
          userId: user.id,
          updatedFields: Object.keys(updateData)
        });
    
        return {
          success: true,
          user: existingUser,
          message: 'Profile updated successfully'
        };
      } catch (error) {
        logger.error('Unexpected error during profile update', {
          userId: user.id,
          error: error.message,
          stack: error.stack
        });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to update user profile', {
          extensions: {
            code: 'INTERNAL_SERVER_ERROR',
          }
        });
      }
    }),

    updateNotificationSettings: requireAuth(async (_, { input }, { user, deviceId }) => {
      logger.info('Updating notification settings requested', { userId: user.id, input });
      const transaction = await sequelize.transaction();
      try {
        const userRecord = await UserModel.findByPk(user.id, { transaction });
        if (!userRecord) {
          logger.error('User not found during notification settings update', { userId: user.id });
          throw new GraphQLError('Account not found. Please log in again.', {
            extensions: { code: 'NOT_FOUND'}
          });
        }

        // Validate push notification + fcmToken logic
        if (input.pushNotifications === true && !input.fcmToken) {
          logger.warn('Attempted to enable push notifications without providing an FCM token', { userId: user.id });
          throw new GraphQLError('Please allow notifications on your device.', {
            extensions: { code: 'FCM_TOKEN_REQUIRED' }
          });
        }

        // Prepare update data for user
        const updateData = {};
        if (typeof input.pushNotifications === 'boolean') updateData.pushNotificationsEnabled = input.pushNotifications;
        if (typeof input.emailNotifications === 'boolean') updateData.emailNotificationsEnabled = input.emailNotifications;
        if (typeof input.communityUpdates === 'boolean') updateData.communityUpdatesEnabled = input.communityUpdates;
        if (typeof input.eventReminders === 'boolean') updateData.eventRemindersEnabled = input.eventReminders;

        if (Object.keys(updateData).length === 0 && !input.fcmToken) {
          logger.warn('No valid notification fields or FCM token provided for update', { userId: user.id });
          throw new GraphQLError('Nothing to update.', {
            extensions: { code: 'NO_FIELDS_TO_UPDATE' }
          });
        }

        // Update user notification settings
        if (Object.keys(updateData).length > 0) {
          await userRecord.update(updateData, { transaction });
        }

        // Update fcmToken for current session if provided
        if (input.fcmToken) {
          const [updatedCount] = await AuthSession.update(
            { fcmToken: input.fcmToken },
            { where: { userId: user.id, deviceId }, transaction }
          );
          if (updatedCount === 0) {
            logger.warn('No active session found to update FCM token', { userId: user.id, deviceId });
            throw new GraphQLError('Could not update device token. Please try again.', {
              extensions: { code: 'SESSION_NOT_FOUND' }
            });
          }
        }

        // If disabling push notifications, clear fcmToken for current session
        if (input.pushNotifications === false) {
          await AuthSession.update(
            { fcmToken: null },
            { where: { userId: user.id, deviceId }, transaction }
          );
        }

        await transaction.commit();

        // Prepare response
        const notificationSettings = {
          pushNotifications: userRecord.pushNotificationsEnabled,
          emailNotifications: userRecord.emailNotificationsEnabled,
          communityUpdates: userRecord.communityUpdatesEnabled,
          eventReminders: userRecord.eventRemindersEnabled
        };

        logger.info('Notification settings updated successfully', {
          userId: user.id,
          updatedFields: Object.keys(updateData)
        });

        return {
          success: true,
          notificationSettings,
          message: 'Settings updated.'
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error updating notification settings', {
          userId: user.id,
          error: error.message,
          stack: error.stack
        });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Could not update settings. Please try again.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    deleteAccount: requireAuth(async (_, { reason }, { user }) => {
      const transaction = await sequelize.transaction();
      try {
        const userRecord = await UserModel.findByPk(user.id, { transaction });
    
        if (!userRecord) {
          logger.error('User not found for deleteAccount', { userId: user.id });
          throw new GraphQLError('User not found', {
            extensions: { code: 'NOT_FOUND' }
          });
        }
    
        if (userRecord.deletedAt) {
          logger.warn('Account already scheduled for deletion', { userId: user.id });
          throw new GraphQLError('Account is already scheduled for deletion', {
            extensions: { code: 'BAD_REQUEST'  }
          });
        }
    
        const scheduledDeletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
        await userRecord.update({
          isActive: false,
          deletedAt: scheduledDeletionDate,
          suspensionReason: reason || 'User requested account deletion'
        }, { transaction });
    
        // Expire all sessions for this user
        await AuthSession.update(
          { isActive: false },
          { where: { userId: user.id }, transaction }
        );
    
        await transaction.commit();
    
        logger.info('Account scheduled for deletion and sessions expired', {
          userId: user.id,
          reason: userRecord.suspensionReason,
          scheduledDeletionDate
        });
    
        return {
          success: true,
          message: 'Account scheduled for deletion',
          scheduledDeletionDate
        };
      } catch (error) {
        await transaction.rollback();
        logger.error('Error scheduling account deletion', {
          userId: user.id,
          error: error.message,
          stack: error.stack
        });
        if(error instanceof GraphQLError) throw error
        throw new GraphQLError('Failed to schedule account deletion', {
          extensions: {
            code: 'INTERNAL_SERVER_ERROR',
          }
        });
      }
    }),
  },

  User: {
    notificationSettings: (user) => ({
      pushNotifications: user.pushNotificationsEnabled,
      emailNotifications: user.emailNotificationsEnabled,
      communityUpdates: user.communityUpdatesEnabled,
      eventReminders: user.eventRemindersEnabled,
    }),

    interests: async (user) => {
      if (user.interests) return user.interests;
      logger.info('Fetching user interests via field resolver', { userId: user.id });
      const userWithInterests = await UserModel.findByPk(user.id, {
        include: [{ model: InterestModel, as: 'interests', through: { attributes: [] } }]
      });
      return userWithInterests.interests;
    }
  }
}

module.exports = userResolvers;
