const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { GraphQLError } = require("graphql");
const { Op } = require("sequelize");
const { OAuth2Client } = require("google-auth-library");
const db = require("../config/dbConfig");
const logger = require("../utils/logger");
const { createAndStorePhoneOTP, verifyAndMarkPhoneOTP } = require("./otpService");

class AuthService {
  constructor() {
    this.oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    this.AuthSession = db.AuthSession;
    this.User = db.User;
    this.OTPVerification = db.OtpVerification;
    this.sequelize = db.sequelize;
  }

  // Helper function to format device names
  formatDeviceName(deviceType, deviceName, userAgent) {
    if (deviceName) return deviceName;

    if (deviceType === "iOS") return "iPhone/iPad";
    if (deviceType === "Android") return "Android Device";
    if (deviceType === "Web") {
      if (userAgent?.includes("Chrome")) return "Chrome Browser";
      if (userAgent?.includes("Firefox")) return "Firefox Browser";
      if (userAgent?.includes("Safari")) return "Safari Browser";
      if (userAgent?.includes("Edge")) return "Edge Browser";
      return "Web Browser";
    }

    return "Unknown Device";
  }

  // Check if user is active, throw error if not
  checkUserActiveOrThrow(user) {
    if (!user.isActive && user.deletedAt) {
      throw new GraphQLError(
        "Account is scheduled for deletion. Please contact support to restore.",
        {
          extensions: {
            code: "ACCOUNT_SCHEDULED_FOR_DELETION",
            deletedAt: user.deletedAt,
          },
        }
      );
    }
    if (!user.isActive) {
      throw new GraphQLError(
        "Account is deactivated. Please contact support.",
        { extensions: { code: "ACCOUNT_DEACTIVATED" } }
      );
    }
  }

  // Validates access token and returns user if session is valid
  async validateToken(token) {
    logger.debug("AuthService: Validating token");
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      logger.debug("AuthService: Token decoded successfully", {
        userId: decoded.userId,
      });

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const session = await this.AuthSession.findOne({
        where: {
          accessTokenHash: tokenHash,
          isActive: true,
          tokenExpiresAt: { [Op.gt]: new Date() },
        },
        include: [
          {
            model: this.User,
            as: "user",
            where: { isActive: true },
          },
        ],
      });

      if (!session) {
        logger.warn("AuthService: No active session found for token", {
          tokenHash,
        });
        return null;
      }

      // Update session usage info
      await session.update({ lastUsedAt: new Date() });
      if (session.user && typeof session.user.updateLastActive === "function") {
        await session.user.updateLastActive();
      }

      logger.info("AuthService: Token validated for user", {
        userId: session.user.id,
      });
      return session;
    } catch (error) {
      logger.warn("AuthService: Token validation failed", {
        error: error.message,
      });
      return null;
    }
  }

  // Generate access and refresh tokens
  async generateTokens(
    userId,
    deviceInfo,
    role,
    transaction,
    ipAddress,
    userAgent
  ) {
    const accessToken = jwt.sign(
      { userId, deviceId: deviceInfo.deviceId, role },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || "1h" }
    );

    const refreshToken = jwt.sign(
      { userId, deviceId: deviceInfo.deviceId, role },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || "30d" }
    );

    const accessTokenHash = crypto
      .createHash("sha256")
      .update(accessToken)
      .digest("hex");
    const refreshTokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const tokenExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Remove existing session for this device
    await this.AuthSession.destroy({
      where: { userId, deviceId: deviceInfo.deviceId },
      transaction,
    });

    // Create new session
    await this.AuthSession.create(
      {
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
        userAgent,
      },
      { transaction }
    );

    logger.info("Auth session created", {
      userId,
      deviceId: deviceInfo.deviceId,
    });

    return { accessToken, refreshToken, expiresAt: tokenExpiresAt };
  }

  // Get active sessions for a user
  async getActiveSessions(userId, currentDeviceId) {
    logger.info("Fetching active sessions", { userId });
    const sessions = await this.AuthSession.findAll({
      where: {
        userId,
        isActive: true,
        refreshExpiresAt: { [Op.gt]: new Date() },
      },
      order: [["lastUsedAt", "DESC"]],
    });

    const sessionsWithCurrentFlag = sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      deviceType: session.deviceType,
      deviceName: this.formatDeviceName(
        session.deviceType,
        session.deviceName,
        session.userAgent
      ),
      appVersion: session.appVersion,
      osVersion: session.osVersion,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      lastUsedAt: session.lastUsedAt,
      tokenExpiresAt: session.tokenExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      isCurrentSession: session.deviceId === currentDeviceId,
    }));

    logger.info("Active sessions fetched", {
      userId,
      sessionCount: sessionsWithCurrentFlag.length,
    });

    return {
      success: true,
      sessions: sessionsWithCurrentFlag,
      totalCount: sessionsWithCurrentFlag.length,
    };
  }

  // Send OTP via SMS
  async sendOTP(phoneNumber, countryCode, type, ipAddress, userAgent) {
    logger.info("Sending OTP via Kaleyra", { phoneNumber, countryCode, type });
    // User existence and type checks
    let user = await this.User.findOne({ where: { phoneNumber, countryCode } });

    if (user && type === "POST_GOOGLE_VERIFY") {
      throw new GraphQLError(
        "Phone is already registered with another account",
        {
          extensions: { code: "PHONE_CONFLICT" },
        }
      );
    } else if (user && type === "PHONE_AUTH") {
      this.checkUserActiveOrThrow(user);
    }

    // Use reusable OTP logic
    return await createAndStorePhoneOTP(
      phoneNumber,
      countryCode,
      type,
      ipAddress,
      userAgent
    );
  }

  // Verify OTP and handle user creation/login
  async verifyOTP(
    phoneNumber,
    countryCode,
    otp,
    deviceInfo,
    type,
    role,
    ipAddress,
    userAgent
  ) {
    logger.info("Verifying OTP via Kaleyra", {
      phoneNumber,
      countryCode,
      type,
    });
    const transaction = await this.sequelize.transaction();
    try {
      await verifyAndMarkPhoneOTP(
        phoneNumber,
        countryCode,
        otp,
        type,
        transaction
      );

      // User creation/login logic
      let user = await this.User.findOne({
        where: { phoneNumber, countryCode },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (user) this.checkUserActiveOrThrow(user);

      const isNewUser = !user;
      if (isNewUser) {
        user = await this.User.create(
          {
            phoneNumber,
            countryCode,
            isPhoneVerified: true,
            onboardingStep: "PROFILE_SETUP",
            role: role || "USER",
          },
          { transaction }
        );
        logger.info("New user created via Kaleyra OTP", { userId: user.id });
      } else {
        logger.info("Existing user logged in via Kaleyra OTP", {userId: user.id });
      }

      // Generate tokens
      const { accessToken, refreshToken } = await this.generateTokens(
        user.id,
        deviceInfo,
        user.role,
        transaction,
        ipAddress,
        userAgent
      );

      logger.info("Tokens issued after Kaleyra OTP verification", {
        userId: user.id,
        deviceId: deviceInfo?.deviceId,
      });

      await transaction.commit();

      return {
        success: true,
        message: isNewUser
          ? "Account created successfully"
          : "Login successful",
        user,
        isNewUser,
        authTokens: { accessToken, refreshToken },
      };
    } catch (error) {
      if(transaction && !transaction.finished){
        await transaction.rollback();
      }
      logger.error("OTP verification failed", {
        phoneNumber,
        error: error.message,
      });
      if (error instanceof GraphQLError) throw error;
      throw error;
    }
  }

  // Refresh authentication tokens
  async refreshAuthTokens(refreshToken, ipAddress, userAgent) {
    logger.info("Attempting to refresh JWT token");
    const transaction = await this.sequelize.transaction();
    try {
      const trimmedToken = refreshToken?.trim();
      if (!trimmedToken || typeof trimmedToken !== "string" || trimmedToken.length < 20) {
        throw new GraphQLError("Invalid or missing refresh token", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(trimmedToken, process.env.REFRESH_TOKEN_SECRET);
      } catch (err) {
        logger.warn("JWT verification failed", { tokenError: err.message });
        throw new GraphQLError("Invalid or expired refresh token", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      if (!decoded?.userId) {
        throw new GraphQLError("Malformed refresh token payload", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const refreshTokenHash = crypto
        .createHash("sha256")
        .update(trimmedToken)
        .digest("hex");

      const session = await this.AuthSession.findOne({
        where: {
          refreshTokenHash,
          isActive: true,
          refreshExpiresAt: { [Op.gt]: new Date() },
        },
        transaction,
      });

      if (!session) {
        logger.warn("Session not found or expired", { userId: decoded.userId });
        throw new GraphQLError("Refresh session is invalid or expired", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const user = await this.User.findOne({
        where: { id: session.userId },
        transaction,
      });

      if (!user) {
        logger.warn("User not found for refresh attempt", {
          userId: session.userId,
        });
        throw new GraphQLError("User account is not active", {
          extensions: { code: "FORBIDDEN" },
        });
      }

      this.checkUserActiveOrThrow(user);

      const {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
      } = await this.generateTokens(
        user.id,
        {
          deviceId: session.deviceId,
          deviceType: session.deviceType,
          deviceName: session.deviceName,
          appVersion: session.appVersion,
          osVersion: session.osVersion,
          fcmToken: session.fcmToken,
        },
        user.role,
        transaction,
        ipAddress,
        userAgent
      );

      await session.update(
        {
          accessTokenHash: crypto
            .createHash("sha256")
            .update(accessToken)
            .digest("hex"),
          refreshTokenHash: crypto
            .createHash("sha256")
            .update(newRefreshToken)
            .digest("hex"),
          lastUsedAt: new Date(),
        },
        { transaction }
      );

      await transaction.commit();

      logger.info("Token refreshed successfully", {
        userId: user.id,
        deviceId: session.deviceId,
      });

      return {
        success: true,
        authTokens: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresAt,
        },
        message: "Token refreshed successfully",
      };
    } catch (error) {
      if(transaction && !transaction.finished){
        await transaction.rollback();
      }      
      logger.error("Refresh token failed", {
        error: error.message || error,
        stack: error.stack,
      });
      // Ensure GraphQL error is thrown correctly
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError("Failed to refresh token", {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }
  }

  // Google authentication
  async authenticateWithGoogle(idToken, deviceInfo, ipAddress, userAgent) {
    logger.info("Google auth initiated");
    const transaction = await this.sequelize.transaction();
    try {
      if (!idToken) {
        logger.warn("Missing idToken");
        throw new GraphQLError("Google idToken is required", {
          extensions: { code: "GOOGLE_AUTH_FAILED" },
        });
      }
  
      // Verify Google token
      let payload;
      try {
        logger.info("Verifying Google idToken");
        const ticket = await this.oauth2Client.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (verifyError) {
        logger.error("Google token verification failed", {
          message: verifyError.message,
          name: verifyError.name,
        });
        throw new GraphQLError("Invalid or expired Google token", {
          extensions: { code: "GOOGLE_AUTH_FAILED" },
        });
      }
  
      if (!payload || !payload.sub || !payload.email) {
        logger.error("Incomplete Google payload", {
          payloadKeys: Object.keys(payload || {}),
        });
        throw new GraphQLError("Incomplete Google token payload", {
          extensions: { code: "GOOGLE_AUTH_FAILED" },
        });
      }
  
      const { sub: googleId, email, name , picture } = payload;
  
      let user = await this.User.findOne({ where: { googleId }, transaction });
      let isNewUser = false;
  
      if (!user) {
        user = await this.User.findOne({ where: { email }, transaction });
      }
  
      if (user) this.checkUserActiveOrThrow(user);
  
      // Case 1: New User
      if (!user) {
        user = await this.User.create({
          googleId,
          email,
          profileImageUrl: picture,
          name: name || email,
          isEmailVerified: true,
          onboardingStep: "INTERESTS_SELECTION",
          isProfileComplete: true,
          isActive: true,
        }, { transaction });
  
        isNewUser = true;
        logger.info("New user created via Google", { userId: user.id });
      }else{
        logger.info("User already exist, Update lats login Time", { userId: user.id });
        // Update last Login of user
        await user.update({ googleId }, { transaction });
      }
  
      // Case 2: Valid Google login
      const { accessToken, refreshToken, expiresAt } = await this.generateTokens(
        user.id,
        deviceInfo,
        user.role,
        transaction,
        ipAddress,
        userAgent
      );
  
      await transaction.commit();
  
      logger.info("Google login successful", {
        userId: user.id,
        deviceId: deviceInfo.deviceId,
      });
  
      return {
        success: true,
        user,
        isNewUser,
        onboardingStep: user.onboardingStep,
        authTokens: { accessToken, refreshToken, expiresAt },
        message: isNewUser ? "Account created via Google" : "Login successful",
      };
    } catch (error) {
      await transaction.rollback();
      logger.error("Google Auth failed", {
        message: error.message,
        stack: error.stack,
      });
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError("Something went wrong during Google login", {
        extensions: { code: "GOOGLE_AUTH_FAILED" },
      });
    }
  }
  
  // Logout from devices
  async logout(userId, currentDeviceId, deviceIdFromFrontend, allDevices) {
    const transaction = await this.sequelize.transaction();
    try {
      const whereClause = {
        userId,
        isActive: true,
      };
  
      if (allDevices) {
        // Logout from all devices except current
        whereClause.deviceId = { [Op.ne]: currentDeviceId };
      } else if (deviceIdFromFrontend) {
        // Secure logout from a specific device
        const sessionToLogout = await this.AuthSession.findOne({
          where: {
            userId,
            deviceId: deviceIdFromFrontend,
            isActive: true,
          },
          transaction,
        });

        if (!sessionToLogout) {
          logger.warn("Unauthorized logout attempt from unknown device", {
            userId,
            deviceIdFromFrontend,
          });
  
          throw new GraphQLError("Device not found or unauthorized", {
            extensions: { code: "UNAUTHORIZED_DEVICE_LOGOUT" },
          });
        }
        whereClause.deviceId = deviceIdFromFrontend;
      } else {
        // Default: logout from current device
        whereClause.deviceId = currentDeviceId;
      }
  
      const [updatedCount] = await this.AuthSession.update(
        { isActive: false },
        { where: whereClause, transaction }
      );
  
      if (updatedCount === 0) {
        throw new GraphQLError("No active session found to logout", {
          extensions: { code: "SESSION_NOT_FOUND" },
        });
      }
  
      await transaction.commit();
  
      logger.info("Logout successful", {
        userId,
        currentDeviceId,
        deviceIdFromFrontend,
        allDevices,
        updatedCount,
      });
  
      return {
        success: true,
        message: allDevices
          ? "Logged out from all other devices"
          : deviceIdFromFrontend
            ? "Logged out from selected device"
            : "Logged out from current device",
      };
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      logger.error("Logout failed", {
        userId,
        currentDeviceId,
        deviceIdFromFrontend,
        allDevices,
        error: error.message,
      });
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError("Logout operation failed", {
        extensions: { code: "LOGOUT_FAILED" },
      });
    }
  }

  // Verify Google phone OTP during onboarding
  async verifyGooglePhoneOTP(
    userId,
    phoneNumber,
    countryCode,
    otp,
    deviceInfo,
    type,
    ipAddress,
    userAgent
  ) {
    logger.info("Verifying Google onboarding OTP", {
      phoneNumber,
      countryCode,
      type,
      userId,
    });
  
    const transaction = await this.sequelize.transaction();
    try {
      // Verify OTP
      await verifyAndMarkPhoneOTP(
        phoneNumber,
        countryCode,
        otp,
        type,
        transaction
      );
  
      const user = await this.User.findByPk(userId, { transaction });
      if (!user) {
        logger.warn("User not found during phone OTP verification", { userId });
        throw new GraphQLError("Authenticated user not found", {
          extensions: { code: "USER_NOT_FOUND" },
        });
      }
  
      // Update phone verification
      await user.update(
        {
          phoneNumber,
          countryCode,
          isPhoneVerified: true,
          onboardingStep: "PROFILE_SETUP",
          isProfileComplete: false,
        },
        { transaction }
      );
  
      logger.info("Phone verified and user record updated", {
        userId: user.id,
      });
  
      const { accessToken, refreshToken, expiresAt } = await this.generateTokens(
        user.id,
        deviceInfo,
        user.role,
        transaction,
        ipAddress,
        userAgent
      );
  
      await transaction.commit();
  
      return {
        success: true,
        user,
        isNewUser: false,
        onboardingStep: user.onboardingStep,
        authTokens: { accessToken, refreshToken, expiresAt },
        message: "Phone number verified. Onboarding advanced to profile setup.",
      };
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      logger.error("Google onboarding OTP verification failed", {
        userId,
        phoneNumber,
        error: error.message,
      });
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError("OTP verification failed", {
        extensions: { code: "VERIFY_PHONE_FAILED" },
      });
    }
  }
}

module.exports = new AuthService();
