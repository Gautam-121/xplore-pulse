const { requireAuth } = require('../middleware/auth');
const db = require("../config/dbConfig")
const { GraphQLError } = require("graphql");
const userService = require('../services/userService');
const ValidationService = require('../utils/validation');
const fileUploadService = require('../services/fileUploadService');
const logger = require("../utils/logger")


const userResolvers = {
  Query: {
    currentUser: requireAuth(async (_, __, { user }) => {
      try {
        return await userService.getCurrentUser(user.id);
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to fetch current user', {
          extensions: { code: 'CURRENT_USER_FAILED' }
        });
      }
    })
  },

  Mutation: {
    completeProfileSetup: requireAuth(async (_, { input }, { user, ipAddress, userAgent }) => {
      try {
        let { name: rawName, bio: rawBio, profileImageUrl, email: rawEmail, location } = input;
        // Sanitize inputs
        const name = ValidationService.sanitizeName(rawName);
        const bio = ValidationService.sanitizeBio(rawBio);
        const email = ValidationService.sanitizeEmail(rawEmail);
        // Validate inputs
        ValidationService.validateName(name);
        ValidationService.validateBio(bio);

        if (email) ValidationService.validateEmail(email);
        let geoLocation = undefined;
        if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
          ValidationService.validateLatitude(location.latitude);
          ValidationService.validateLongitude(location.longitude);
        }

        // Validate image URL if provided
        if (profileImageUrl) {
          ValidationService.validateImageUrl(profileImageUrl, 'profileImageUrl');
        }

        return await userService.completeProfileSetup(
          user.id,
          { name, bio, profileImageUrl, email, location: geoLocation },
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error('completeProfileSetup resolver failed', {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Profile completion failed', {
          extensions: { code: 'PROFILE_SETUP_FAILED' },
        });
      }
    }),

    resendEmailOTP: requireAuth(async (_, { email }, { user, ipAddress, userAgent }) => {
      try {
        const sanitizedEmail = ValidationService.sanitizeEmail(email);
        ValidationService.validateEmail(sanitizedEmail);
        return await userService.resendEmailOTP(user.id, sanitizedEmail, ipAddress, userAgent);
      } catch (error) {
        logger.error("ResendEmailOTP resolver failed", {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Resend email OTP failed", {
          extensions: { code: "RESEND_EMAIL_OTP_FAILED" },
        });
      }
    }),

    verifyEmailOTP: requireAuth(async (_, { email, otp }, { user }) => {
      try {
        const sanitizedEmail = ValidationService.sanitizeEmail(email);
        const sanitizedOTP = ValidationService.sanitizeOTP(otp);
        ValidationService.validateEmail(sanitizedEmail);
        ValidationService.validateOTP(sanitizedOTP);
        return await userService.verifyEmailOTPService(user.id, sanitizedEmail, sanitizedOTP);
      } catch (error) {
        logger.error("verifyEmailOTP resolver failed", {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Verify email OTP failed", {
          extensions: { code: "VERIFY_EMAIL_OTP_FAILED" },
        });
      }
    }),

    requestEmailUpdate: requireAuth(async (_, { email }, { user, ipAddress, userAgent }) => {
      try {
        const sanitizedEmail = ValidationService.sanitizeEmail(email);
        ValidationService.validateEmail(sanitizedEmail);
        return await userService.requestEmailUpdate(
          user.id,
          sanitizedEmail,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("requestEmailUpdate resolver failed", {
          userId: user.id,
          error: error.message,
          code: error.extensions?.code,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to send email verification", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    }),

    verifyAndUpdateEmail: requireAuth(async (_, { otp }, { user }) => {
      try {
        const sanitizedOTP = ValidationService.sanitizeOTP(otp);
        ValidationService.validateOTP(sanitizedOTP);
        return await userService.verifyAndUpdateEmail(user.id, sanitizedOTP);
      } catch (error) {
        logger.error("verifyAndUpdateEmail resolver failed", {
          userId: user.id,
          error: error.message,
          code: error.extensions?.code,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to verify and update email", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    }),

    requestPhoneUpdate: requireAuth(async (_, { phoneNumber, countryCode }, { user, ipAddress, userAgent }) => {
      try {
        const sanitizedPhone = ValidationService.sanitizePhoneNumber(phoneNumber);
        const sanitizedCountryCode = ValidationService.sanitizeCountryCode(countryCode);
        ValidationService.validatePhoneNumber(sanitizedPhone, sanitizedCountryCode);
        return await userService.requestPhoneUpdate(
          user.id,
          sanitizedPhone,
          sanitizedCountryCode,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("requestPhoneUpdate resolver failed", {
          userId: user.id,
          error: error.message,
          code: error.extensions?.code,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to send phone verification", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    }),

    verifyAndUpdatePhone: requireAuth(async (_, { otp }, { user }) => {
      try {
        const sanitizedOTP = ValidationService.sanitizeOTP(otp);
        ValidationService.validateOTP(sanitizedOTP);
        return await userService.verifyAndUpdatePhone(user.id, sanitizedOTP);
      } catch (error) {
        logger.error("verifyAndUpdatePhone resolver failed", {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to verify and update phone", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    }),

    selectInterests: requireAuth(async (_, { interestIds }, { user }) => {
      try {
        const sanitizedInterestIds = ValidationService.sanitizeArrayUUID(interestIds);
        ValidationService.validateArrayOfUUIDs(sanitizedInterestIds, "interestIds");
        return await userService.selectInterests(user.id, sanitizedInterestIds);
      } catch (error) {
        logger.error("selectInterests resolver failed", {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to select interest", {
          extensions: { code: "SELECT_INTEREST_FAILED" },
        });
      }
    }),

    updateOnboardingStep: requireAuth(async (_, { step }, { user }) => {
      try {
        return await userService.updateOnboardingStep(user.id, step);
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to update onboarding step', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        });
      }
    }),

    updateUserProfile: requireAuth(async (_, { input }, { user }) => {
      try {
        const sanitizedInput = {
          name: input.name ? ValidationService.sanitizeName(input.name) : undefined,
          bio: input.bio ? ValidationService.sanitizeBio(input.bio) : undefined,
          profileImageUrl: input.profileImageUrl,
          removeProfileImage: !!input.removeProfileImage,
        };
        if (sanitizedInput.name) ValidationService.validateName(sanitizedInput.name);
        if (sanitizedInput.bio) ValidationService.validateBio(sanitizedInput.bio);

        // Validate image URL if provided
        if (sanitizedInput.profileImageUrl) {
          ValidationService.validateImageUrl(sanitizedInput.profileImageUrl, 'profileImageUrl');
        }

        // Pass to service
        return await userService.updateUserProfile(user.id, sanitizedInput);
      } catch (error) {
        logger.error('updateUserProfile resolver failed', {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to update user profile', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    }),

    updateNotificationSettings: requireAuth(async (_, { input }, { user, deviceId }) => {
      try {
        const sanitizedInput = {
          pushNotifications: typeof input.pushNotifications === 'boolean' ? input.pushNotifications : undefined,
          emailNotifications: typeof input.emailNotifications === 'boolean' ? input.emailNotifications : undefined,
          communityUpdates: typeof input.communityUpdates === 'boolean' ? input.communityUpdates : undefined,
          eventReminders: typeof input.eventReminders === 'boolean' ? input.eventReminders : undefined,
          fcmToken: input.fcmToken ? ValidationService.sanitizeName(input.fcmToken) : undefined,
        };
    
        if (sanitizedInput.fcmToken) {
          ValidationService.validateFCMToken(sanitizedInput.fcmToken);
        }
        return await userService.updateNotificationSettings(user.id, deviceId, sanitizedInput);
      } catch (error) {
        logger.error('updateNotificationSettings resolver failed', {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
    
        throw new GraphQLError('Could not update settings. Please try again.', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    }),

    deleteAccount: requireAuth(async (_, { reason }, { user }) => {
      try {
        return await userService.deleteAccount(user.id, reason?.trim());
      } catch (error) {
        logger.error('deleteAccount resolver failed', {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to schedule account deletion', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      }
    }),

    uploadFile: requireAuth(async (_, { file }, context) => {
      try {
        if (!file) {
          throw new GraphQLError('No file provided.', {
            extensions: { code: 'NO_FILE_PROVIDED' }
          });
        }
        let fileObj = await file;
        if (fileObj.file) fileObj = fileObj.file;
        const { createReadStream, filename, mimetype } = fileObj;
        const stream = createReadStream();
        const buffer = await fileUploadService.streamToBuffer(stream);
        const { mediaType, detectedMime } = await fileUploadService.detectMediaType(buffer, mimetype, filename);
        let url, status = 'READY';
        try {
          fileUploadService.validateFileSize(mediaType, buffer.length);
          if (mediaType === 'IMAGE') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
            status = 'READY';
          } else if (mediaType === 'VIDEO') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
            status = 'READY';
          } else if (mediaType === 'DOCUMENT') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
            status = 'READY';
          } else {
            throw new GraphQLError('Unsupported file type', { extensions: { code: 'UNSUPPORTED_TYPE' } });
          }
        } catch (err) {
          return {
            success: false,
            url: null,
            type: mediaType,
            status: 'FAILED',
            originalName: filename,
            mimetype: detectedMime,
            size: buffer.length,
            error: err.message,
          };
        }
        return {
          success: true,
          url,
          type: mediaType,
          status,
          originalName: filename,
          mimetype: detectedMime,
          size: buffer.length,
        };
      } catch (error) {
        context.logger?.error?.('uploadFile mutation failed', { error });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError(error?.message || 'File upload failed.', {
          extensions: { code: 'FILE_UPLOAD_FAILED' }
        });
      }
    }),

    uploadFiles: async (_, { files }, context) => {
      if (!Array.isArray(files) || files.length === 0) {
        throw new GraphQLError('No files provided', { extensions: { code: 'NO_FILES' } });
      }
      const uploadResults = await Promise.all(files.map(async (filePromise) => {
        let fileObj;
        try {
          fileObj = await filePromise; // GraphQL Upload
          if (fileObj.file) fileObj = fileObj.file;
          const { createReadStream, filename, mimetype } = fileObj;
          const stream = createReadStream();
          const buffer = await fileUploadService.streamToBuffer(stream);
          const { mediaType, detectedMime } = await fileUploadService.detectMediaType(buffer, mimetype, filename);
          fileUploadService.validateFileSize(mediaType, buffer.length);
          let url, status = 'READY';
          if (mediaType === 'IMAGE') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
          } else if (mediaType === 'VIDEO') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
          } else if (mediaType === 'DOCUMENT') {
            url = await fileUploadService.uploadFile({ buffer, originalname: filename, mimetype: detectedMime });
          } else {
            throw new GraphQLError('Unsupported file type', { extensions: { code: 'UNSUPPORTED_TYPE' } });
          }
          return {
            success: true,
            url,
            type: mediaType,
            status,
            originalName: filename,
            mimetype: detectedMime,
            size: buffer.length,
          };
        } catch (err) {
          return {
            success: false,
            url: null,
            type: null,
            status: 'FAILED',
            originalName: (fileObj && fileObj.filename) || null,
            mimetype: (fileObj && fileObj.mimetype) || null,
            size: (fileObj && fileObj.size) || null,
            error: err.message || 'Unknown error',
          };
        }
      }));
      return uploadResults;
    },
  },

  User: {
    notificationSettings: (user) => ({
      pushNotifications: user.pushNotificationsEnabled,
      emailNotifications: user.emailNotificationsEnabled,
      communityUpdates: user.communityUpdatesEnabled,
      eventReminders: user.eventRemindersEnabled
    }),

    interests: async (user) => {
      try {
        if (user.interests) return user.interests;
        logger.info('Fetching user interests via field resolver', { userId: user.id });
        const userWithInterests = await db.User.findByPk(user.id, {
          include: [{ model: db.Interest, as: 'interests', through: { attributes: [] } }]
        });
        return userWithInterests.interests;
      } catch (error) {
        logger.error('Failed to fetch user interests', { userId: user.id, error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError('Failed to fetch user interests', {
          extensions: { code: 'FETCH_INTERESTS_FAILED' }
        });
      }
    }
  }
};

module.exports = userResolvers;