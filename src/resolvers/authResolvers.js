const { GraphQLError } = require("graphql");
const ValidationService = require("../utils/validation");
const { requireAuth } = require("../middleware/auth");
const authService = require("../services/authService");
const logger = require("../utils/logger");

const authResolvers = {
  Query: {
    activeSessions: requireAuth(
      async (_, __, { user, deviceId: currentDeviceId }) => {
        try {
          return await authService.getActiveSessions(user.id, currentDeviceId);
        } catch (error) {
          logger.error("Failed to fetch active sessions", {
            userId: user.id,
            error: error.message,
          });
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError("Failed to fetch active sessions", {
            extensions: { code: "FETCH_ACTIVE_SESSIONS" },
          });
        }
      }
    ),
  },

  Mutation: {
    sendOTP: async (_, { input }, { ipAddress, userAgent }) => {
      const { phoneNumber, countryCode, type } = input;
      const sanitizePhone = ValidationService.sanitizePhoneNumber(phoneNumber);
      const sanitizeCountryCode =ValidationService.sanitizeCountryCode(countryCode);
      ValidationService.validatePhoneNumber(sanitizePhone, sanitizeCountryCode);

      try {
        return await authService.sendOTP(
          sanitizePhone,
          sanitizeCountryCode,
          type,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("SendOTP resolver failed", {
          phoneNumber,
          countryCode,
          type,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to send OTP", {
          extensions: { code: "SEND_OTP_FAILED" },
        });
      }
    },

    verifyOTP: async (_, { input }, { ipAddress, userAgent }) => {
      const { phoneNumber, countryCode, otp, deviceInfo, type, role } = input;
      const sanitizePhone = ValidationService.sanitizePhoneNumber(phoneNumber);
      const sanitizeCountryCode = ValidationService.sanitizeCountryCode(countryCode);
      const sanitizeOTP = ValidationService.sanitizeOTP(otp);
      const sanitizeDeviceInfo = ValidationService.sanitizeDeviceInfo(deviceInfo)
      ValidationService.validatePhoneNumber(sanitizePhone, sanitizeCountryCode);
      ValidationService.validateDeviceInfo(sanitizeDeviceInfo);
      ValidationService.validateOTP(sanitizeOTP);

      try {
        return await authService.verifyOTP(
          sanitizePhone,
          sanitizeCountryCode,
          sanitizeOTP,
          sanitizeDeviceInfo,
          type,
          role,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("VerifyOTP resolver failed", {
          phoneNumber,
          countryCode,
          type,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to verify OTP", {
          extensions: { code: "VERIFY_OTP_FAILED" },
        });
      }
    },

    refreshToken: async (_, { refreshToken }, { ipAddress, userAgent }) => {
      try {
        return await authService.refreshAuthTokens(
          refreshToken,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("RefreshToken resolver failed", { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Invalid refresh token", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
    },

    googleAuth: async (_, { input }, { ipAddress, userAgent }) => {
      const { idToken, deviceInfo } = input;
      const sanitizeDeviceInfo = ValidationService.sanitizeDeviceInfo(deviceInfo)
      const trimmedIdToken = idToken?.trim()
      ValidationService.validateDeviceInfo(sanitizeDeviceInfo);
      try {
        return await authService.authenticateWithGoogle(
          trimmedIdToken,
          sanitizeDeviceInfo,
          ipAddress,
          userAgent
        );
      } catch (error) {
        logger.error("GoogleAuth resolver failed", { error: error.message });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Google authentication failed", {
          extensions: { code: "GOOGLE_AUTH_FAILED" },
        });
      }
    },

    logout: requireAuth(async (_, { deviceId, allDevices }, { user, deviceId: currentDeviceId }) => {
      try {
        let deviceIdFromFrontend = null;
        if (deviceId) {
          ValidationService.validateUUID(deviceId, 'deviceId');
          deviceIdFromFrontend = ValidationService.sanitizeUUID(deviceId);
        }

        console.log("user" , user)

        return await authService.logout(
          user.id,
          currentDeviceId,
          deviceIdFromFrontend,
          allDevices
        );
      } catch (error) {
        logger.error("Logout resolver failed", {
          userId: user.id,
          error: error.message,
        });
        if (error instanceof GraphQLError) throw error;
        throw new GraphQLError("Failed to logout", {
          extensions: { code: "LOGOUT_FAILED" },
        });
      }
    }),

    verifyGooglePhoneOTP: requireAuth(
      async (_, { input }, { user, ipAddress, userAgent }) => {
        try {
          const {
            phoneNumber: rawPhone,
            countryCode: rawCode,
            otp: rawOTP,
            deviceInfo,
            type,
          } = input;
    
          const sanitizedPhone = ValidationService.sanitizePhoneNumber(rawPhone);
          const sanitizedCode = ValidationService.sanitizeCountryCode(rawCode);
          const sanitizedOTP = ValidationService.sanitizeOTP(rawOTP);
          const sanitizedDeviceInfo = ValidationService.sanitizeDeviceInfo(deviceInfo);
    
          ValidationService.validatePhoneNumber(sanitizedPhone, sanitizedCode);
          ValidationService.validateOTP(sanitizedOTP);
          ValidationService.validateDeviceInfo(sanitizedDeviceInfo);
    
          return await authService.verifyGooglePhoneOTP(
            user.id,
            sanitizedPhone,
            sanitizedCode,
            sanitizedOTP,
            sanitizedDeviceInfo,
            type,
            ipAddress,
            userAgent
          );
        } catch (error) {
          logger.error("verifyGooglePhoneOTP resolver failed", {
            userId: user.id,
            error: error.message,
          });
    
          if (error instanceof GraphQLError) throw error;
    
          throw new GraphQLError("Failed to verify phone during onboarding", {
            extensions: { code: "VERIFY_PHONE_FAILED" },
          });
        }
      }
    ),
  },
};

module.exports = authResolvers;
