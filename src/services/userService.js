const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');
const db = require("../config/dbConfig");
const fileUploadService = require("../services/fileUploadService");
const { sendEmailOTP, verifyEmailOTP, createAndStorePhoneOTP, verifyAndMarkPhoneOTP } = require('../services/otpService');
const { allowOnboardingSteps } = require('../utils/constant');
const { Op } = require("sequelize")

class UserService {
    constructor() {
        this.AuthSession = db.AuthSession;
        this.InterestModel = db.Interest;
        this.UserModel = db.User;
        this.UserInterestModel = db.UserInterest;
        this.OTPVerification = db.OtpVerification;
        this.sequelize = db.sequelize;
    }


    async getCurrentUser(userId) {
        try {
            logger.info('Fetching current user', { userId });
            const currentUser = await this.UserModel.findByPk(userId, {
                include: [{ model: this.InterestModel, as: 'interests', through: { attributes: [] } }]
            });
            if (!currentUser) {
                logger.warn('User not found during currentUser query', { userId });
                throw new GraphQLError('User not found', { extensions: { code: 'USER_NOT_FOUND' } });
            }
            logger.info('Fetched current user with interests', { userId });
            return currentUser;
        } catch (error) {
            logger.error('Failed to fetch current user', { userId, error: error.message });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch current user', {
                extensions: { code: 'CURRENT_USER_FAILED' }
            });
        }
    }

    async completeProfileSetup(userId, input, ipAddress, userAgent) {
        const transaction = await this.sequelize.transaction();
        let uploadedFileUrl = null;
        try {
            const { name, bio, profileImage, email, location } = input;
            logger.info('Starting profile setup', { userId });

            const userRecord = await this.UserModel.findByPk(userId, { transaction });
            if (!userRecord) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'USER_NOT_FOUND' },
                });
            }

            if(["INTERESTS_SELECTION", "COMMUNITY_RECOMMENDATIONS", "COMPLETED"].includes(userRecord.onboardingStep)){
                throw new GraphQLError(
                    "Profile completion is already done",{
                        extensions: { code: "CONFICT_ERROR"}
                    }
                )
            }

            if(email && ((userRecord.email && userRecord.isEmailVerified) && (userRecord.email && userRecord.googleId))){
                throw new GraphQLError("Can't change the verified email in profile setup", {
                    extensions: { code: "BAD_REQUEST"}
                })
            }

            // Handle geospatial location
            if (location) {
                if (location.latitude && !location.longitude) {
                    throw new GraphQLError('Longitude is required when latitude is provided', {
                        extensions: { code: 'BAD_USER_INPUT' },
                    });
                }
                if (location.longitude && !location.latitude) {
                    throw new GraphQLError('Latitude is required when longitude is provided', {
                        extensions: { code: 'BAD_USER_INPUT' },
                    });
                }
                if (location.latitude && location.longitude) {
                    updateData.latitude = location.latitude;
                    updateData.longitude = location.longitude;
                }
            }

            // Email uniqueness check
            if (email) {
                const existingUser = await this.UserModel.findOne({
                    where: { email },
                    transaction,
                });
                if (existingUser && existingUser.id !== userId) {
                    throw new GraphQLError('Email already in use in another account', {
                        extensions: { code: 'EMAIL_IN_USE' },
                    });
                }
            }

            const updateData = {
                name,
                bio,
                isProfileComplete: true,
                onboardingStep: email ? 'PROFILE_SETUP' : 'INTERESTS_SELECTION',
            };

            // Profile image handling
            if (profileImage) {
                fileUploadService.validateImageFile(profileImage.file);
                try {
                    uploadedFileUrl = await fileUploadService.uploadFile(
                        profileImage.file,
                        'profile-images'
                    );
                    updateData.profileImageUrl = uploadedFileUrl;
                    logger.info('Profile image uploaded', { userId });
                } catch (uploadErr) {
                    logger.error('Profile image upload failed', {
                        userId,
                        error: uploadErr.message,
                    });
                    throw new GraphQLError('Failed to upload profile image', {
                        extensions: { code: 'BAD_USER_INPUT' },
                    });
                }
            }

            // Update user
            if (email) updateData.email = email;
            await userRecord.update(updateData, { transaction });

            // Email verification
            if (email) {
                await sendEmailOTP(userId, email, ipAddress, userAgent , transaction);
                logger.info('Sent email verification OTP', { userId, email });
            }

            await transaction.commit();
            logger.info('Profile setup completed', { userId });
            return {
                success: true,
                user: userRecord,
                message: email
                    ? 'Profile setup completed. Please verify your email.'
                    : 'Profile setup completed',
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            if (uploadedFileUrl) {
                try {
                    await fileUploadService.deleteFile(uploadedFileUrl);
                    logger.info('Uploaded profile image rolled back', { uploadedFileUrl });
                } catch (cleanupErr) {
                    logger.warn('Failed to delete uploaded image during rollback', {
                        fileUrl: uploadedFileUrl,
                        error: cleanupErr.message,
                    });
                }
            }
            logger.error('Profile setup failed', { userId, error: error.message });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Profile completion failed', {
                extensions: { code: 'PROFILE_SETUP_FAILED' },
            });
        }
    }

    async resendEmailOTP(userId, email, ipAddress, userAgent) {
        try {
            logger.info("Resending email OTP", { userId, email });
            const user = await this.UserModel.findByPk(userId);
            if (!user) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "USER_NOT_FOUND" },
                });
            }
            if (!user.email) {
                throw new GraphQLError("User does not have a registered email", {
                    extensions: { code: "EMAIL_NOT_SET" },
                });
            }

            if (user.email.toLowerCase() !== email.toLowerCase()) {
                throw new GraphQLError("You can only resend OTP to your own email", {
                    extensions: { code: "EMAIL_MISMATCH" },
                });
            }

            if(user.isEmailVerified){
                throw new GraphQLError("Your email is already verified", {
                    extensions: { code: "ALREADY_VERIFIED" },
                });
            }

            await sendEmailOTP(userId, email, ipAddress, userAgent);
            logger.info("Verification code resent to email", { userId, email });
            return {
                success: true,
                message: "Verification code resent to your email.",
            };
        } catch (error) {
            logger.error("Resend email OTP failed", {
                userId,
                email,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Resend email OTP failed", {
                extensions: { code: "RESEND_EMAIL_OTP_FAILED" },
            });
        }
    }

    async verifyEmailOTPService(userId, email, otp) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info("Verifying email OTP", { userId, email });
            const user = await this.UserModel.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "USER_NOT_FOUND" },
                });
            }
            if (!user.email) {
                throw new GraphQLError("No email associated with this user", {
                    extensions: { code: "EMAIL_NOT_SET" },
                });
            }
            if (user.email.toLowerCase() !== email.toLowerCase()) {
                throw new GraphQLError("Email does not match user record", {
                    extensions: { code: "EMAIL_MISMATCH" },
                });
            }

            const result = await verifyEmailOTP(userId, email, otp, transaction);
            await user.update(
                {
                    isVerified: true,
                    isEmailVerified: true,
                    onboardingStep: "INTERESTS_SELECTION",
                },
                { transaction }
            );

            await transaction.commit();
            logger.info("Email OTP verified and user updated", {
                userId,
                email,
            });
            return {
                success: true,
                message: result.message || "Email verified successfully",
                user,
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error("Verify email OTP failed", {
                userId,
                email,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Email verification failed", {
                extensions: { code: "VERIFY_EMAIL_OTP_ERROR" },
            });
        }
    }
           
    async requestEmailUpdate(userId, email, ipAddress, userAgent) {
        try {
            logger.info("Starting email update request", { userId });
            const user = await this.UserModel.findByPk(userId);
            if (!user) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "USER_NOT_FOUND" },
                });
            }
            if (user.onboardingStep !== "COMPLETED") {
                throw new GraphQLError("Complete onboarding before updating email", {
                    extensions: { code: "ONBOARDING_INCOMPLETE" },
                });
            }
            if (user.email?.toLowerCase() === email.toLowerCase()) {
                throw new GraphQLError("New email must be different from current", {
                    extensions: { code: "EMAIL_SAME_AS_CURRENT" },
                });
            }
            const existing = await this.UserModel.findOne({
                where: {
                    email: email.toLowerCase(),
                    id: { [Op.ne]: userId },
                },
            });
            if (existing) {
                throw new GraphQLError("Email is already associated with another account", {
                    extensions: { code: "EMAIL_ALREADY_IN_USE" },
                });
            }
            // Update pendingEmail before sending OTP
            await user.update({ pendingEmail: email });
            const result = await sendEmailOTP(userId, email, ipAddress, userAgent);
            logger.info("Email update OTP sent", {
                userId,
                email: email.replace(/(.{2})(.*)(@.*)/, "$1****$3"),
            });
            return {
                success: true,
                message: "OTP sent to your email. Please verify to update your email address.",
                retryAfter: result.retryAfter,
            };
        } catch (error) {
            logger.error("Email update request failed", {
                userId,
                email: email.replace(/(.{2})(.*)(@.*)/, "$1****$3"),
                error: error.message,
                code: error.extensions?.code,
            });

            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Failed to send email verification", {
                extensions: { code: "EMAIL_UPDATE_FAILED" },
            });
        }
    }

    async verifyAndUpdateEmail(userId, otp) {
        const transaction = await this.sequelize.transaction();
        try {
            const user = await this.UserModel.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "USER_NOT_FOUND" },
                });
            }
            if (user.onboardingStep !== 'COMPLETED') {
                throw new GraphQLError('Please complete the onboarding step', {
                    extensions: { code: 'ONBOARDING_NOT_COMPLETED' },
                });
            }
            const pendingEmail = user.pendingEmail;
            if (!pendingEmail) {
                throw new GraphQLError("No pending email found to verify", {
                    extensions: { code: "NO_PENDING_EMAIL" },
                });
            }
            logger.info("Verifying email OTP for email update", {
                userId,
                pendingEmail: pendingEmail.replace(/(.{2})(.*)(@.*)/, "$1****$3"),
            });

            await verifyEmailOTP(userId, pendingEmail, otp, transaction);
            const previousEmail = user.email;
            await user.update(
                {
                    email: pendingEmail,
                    pendingEmail: null,
                    ...(user.googleId && { googleId: null }), // unlink Google if required
                    isEmailVerified: true,
                },
                { transaction }
            );

            await transaction.commit();
            logger.info("Email updated successfully", {
                userId,
                previousEmail: previousEmail?.replace(/(.{2})(.*)(@.*)/, "$1****$3"),
                newEmail: pendingEmail.replace(/(.{2})(.*)(@.*)/, "$1****$3"),
            });
            return {
                success: true,
                message: "Email updated successfully",
                user,
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error("Email verification and update failed", {
                userId,
                error: error.message,
                code: error.extensions?.code,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Failed to verify and update email", {
                extensions: { code: "EMAIL_UPDATE_FAILED" },
            });
        }
    }
      
    async requestPhoneUpdate(userId, phoneNumber, countryCode, ipAddress, userAgent) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info("Starting phone update request", {
                userId,
                phone: `${countryCode} ${phoneNumber.replace(/.(?=.{2})/g, '*')}`,
            });

            const existingUser = await this.UserModel.findByPk(userId, { transaction });
            if (!existingUser) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "NOT_FOUND" },
                });
            }

            if (existingUser.onboardingStep !== "COMPLETED") {
                throw new GraphQLError("Please complete onboarding before updating phone", {
                    extensions: { code: "ONBOARDING_NOT_COMPLETED" },
                });
            }

            const phoneInUse = await this.UserModel.findOne({
                where: { phoneNumber, countryCode },
                transaction,
            });

            if (phoneInUse && phoneInUse.id !== userId) {
                throw new GraphQLError("Phone number already in use by another account", {
                    extensions: { code: "PHONE_IN_USE" },
                });
            }

            if (
                phoneInUse &&
                phoneInUse.id === userId &&
                phoneInUse.phoneNumber === phoneNumber &&
                phoneInUse.countryCode === countryCode &&
                phoneInUse.isPhoneVerified
            ) {
                throw new GraphQLError("Phone number is already verified", {
                    extensions: { code: "PHONE_ALREADY_VERIFIED" },
                });
            }

            await existingUser.update(
                {
                    pendingPhoneNumber: phoneNumber,
                    pendingContryCode: countryCode,
                },
                { transaction }
            );

            await createAndStorePhoneOTP(
                phoneNumber,
                countryCode,
                "PHONE_AUTH",
                ipAddress,
                userAgent
            );

            await transaction.commit();

            logger.info("OTP sent for phone update", { userId });
            return {
                success: true,
                message: "OTP sent to your phone. Please verify to update your phone number.",
                retryAfter: 30,
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error("Error in phone update request", {
                userId,
                phone: `${countryCode} ${phoneNumber.replace(/.(?=.{2})/g, '*')}`,
                error: error.message,
            });

            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Failed to send phone verification", {
                extensions: { code: "PHONE_UPDATE_FAILED" },
            });
        }
    }
      
    async verifyAndUpdatePhone(userId, otp) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info("Starting phone verification and update", { userId });
            const existingUser = await this.UserModel.findByPk(userId, { transaction });
            if (!existingUser) {
                throw new GraphQLError("User not found", {
                    extensions: { code: "NOT_FOUND" },
                });
            }

            if (existingUser.onboardingStep !== 'COMPLETED') {
                throw new GraphQLError('Please complete the onboarding step', {
                    extensions: { code: 'ONBOARDING_NOT_COMPLETED' },
                });
            }

            console.log("existingUser" , existingUser.toJSON())

            const phoneNumber = existingUser.pendingPhoneNumber;
            const countryCode = existingUser.pendingContryCode; // ✅ FIXED typo

            console.log("")
            if (!phoneNumber || !countryCode) {
                throw new GraphQLError("No pending phone update request found", {
                    extensions: { code: "NO_PENDING_PHONE" },
                });
            }

            await verifyAndMarkPhoneOTP(
                phoneNumber,
                countryCode,
                otp,
                "PHONE_AUTH",
                transaction
            );

            await existingUser.update(
                {
                    phoneNumber,
                    countryCode,
                    pendingPhoneNumber: null,
                    pendingCountryCode: null,
                    isPhoneVerified: true,
                },
                { transaction }
            );

            await transaction.commit();
            logger.info("Phone updated successfully", {
                userId,
                phone: `${countryCode} ${phoneNumber.replace(/.(?=.{2})/g, "*")}`,
            });
            return {
                success: true,
                user: existingUser,
                message: "Phone number updated successfully",
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error("Error in phone verification and update", {
                userId,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Failed to verify and update phone", {
                extensions: { code: "INTERNAL_SERVER_ERROR" },
            });
        }
    }
      
    async selectInterests(userId, interestIds) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info("Selecting interests", { userId, interestIds });
            // Validate array presence
            if (!Array.isArray(interestIds) || interestIds.length === 0) {
                throw new GraphQLError("Please select at least one interest", {
                    extensions: { code: "BAD_USER_INPUT", argumentName: "interestIds" },
                });
            }

            // Validate uniqueness
            const uniqueInterestIds = [...new Set(interestIds)];
            if (uniqueInterestIds.length !== interestIds.length) {
                throw new GraphQLError("Duplicate interest IDs are not allowed", {
                    extensions: { code: "BAD_USER_INPUT", argumentName: "interestIds" },
                });
            }

            const userRecord = await this.UserModel.findByPk(userId, { transaction });
            if (!userRecord) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'USER_NOT_FOUND' },
                });
            }

            if(["COMMUNITY_RECOMMENDATIONS", "COMPLETED"].includes(userRecord.onboardingStep)){
                throw new GraphQLError(
                    "Interest selection is already done",{
                        extensions: { code: "CONFICT_ERROR"}
                    }
                )
            }

            // Sanity check (UUIDs already validated in resolver)
            const interests = await this.InterestModel.findAll({
                where: { id: interestIds, isActive: true },
                transaction,
            });

            if (interests.length !== interestIds.length) {
                const foundIds = interests.map((i) => i.id);
                const missingIds = interestIds.filter((id) => !foundIds.includes(id));
                logger.warn("Some interest IDs not found in DB", { userId, missingIds });
                throw new GraphQLError("Some interest IDs are invalid", {
                    extensions: {
                        code: "BAD_USER_INPUT",
                        argumentName: "interestIds",
                        missingIds,
                    },
                });
            }

            // Fetch previous interests
            const oldInterests = await this.UserInterestModel.findAll({
                where: { userId },
                attributes: ["interestId"],
                raw: true,
                transaction,
            });

            const oldInterestIds = oldInterests.map((i) => i.interestId);
            // Replace with new interests
            await this.UserInterestModel.destroy({ where: { userId }, transaction });
            const userInterests = interestIds.map((interestId, index) => ({
                userId,
                interestId,
                priorityOrder: index,
            }));

            await this.UserInterestModel.bulkCreate(userInterests, { transaction });
            // Update follower counts
            const toIncrement = interestIds.filter((id) => !oldInterestIds.includes(id));
            const toDecrement = oldInterestIds.filter((id) => !interestIds.includes(id));

            if (toIncrement.length > 0) {
                await this.InterestModel.increment("followersCount", {
                    by: 1,
                    where: { id: toIncrement },
                    transaction,
                });
            }
            if (toDecrement.length > 0) {
                await this.InterestModel.decrement("followersCount", {
                    by: 1,
                    where: { id: toDecrement },
                    transaction,
                });
            }

            // Fetch updated user with interests
            const updatedUser = await this.UserModel.findByPk(userId, {
                include: [
                    {
                        model: this.InterestModel,
                        as: "interests",
                        through: { attributes: [] },
                    },
                ],
                transaction,
            });

            await updatedUser.update(
                { onboardingStep: "COMMUNITY_RECOMMENDATIONS" },
                { transaction }
            );
            await transaction.commit();
            logger.info("Interests selected", { userId });
            return {
                success: true,
                user: updatedUser,
                recommendedCommunities: [], // TODO: Logic placeholder
                message: "Interests selected successfully",
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error("Interest selection failed", {
                userId,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError("Failed to select interest", {
                extensions: { code: "SELECT_INTEREST_FAILED" },
            });
        }
    }
      
    async updateOnboardingStep(userId, step) {
        try {
            logger.info('Attempting to update onboarding step', { userId, step });
            if (!allowOnboardingSteps.includes(step)) {
                logger.warn('Invalid onboarding step received', { userId, step });
                throw new GraphQLError(`Invalid onboarding step: ${step}`, {
                    extensions: { code: 'BAD_USER_INPUT' }
                });
            }

            const updatedUser = await this.UserModel.findByPk(userId);
            if (!updatedUser) {
                logger.error('User not found during onboarding update', { userId });
                throw new GraphQLError('User not found', {
                    extensions: { code: 'NOT_FOUND' }
                });
            }


            await updatedUser.update({
                onboardingStep: step,
                onboardingCompletedAt: step === 'COMPLETED' ? new Date() : null
            });

            logger.info('Onboarding step updated successfully', { userId, step });

            return {
                success: true,
                user: updatedUser,
                message: 'Onboarding step updated'
            };
        } catch (error) {
            logger.error('Failed to update onboarding step', {
                userId,
                step,
                error: error.message
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to update onboarding step', {
                extensions: { code: 'INTERNAL_SERVER_ERROR' }
            });
        }
    }

    async updateUserProfile(userId, input) {
        const transaction = await this.sequelize.transaction();
        let uploadedFileUrl = null;
        try {
            logger.info('Starting profile update', { userId });
            const { name, bio, profileImage, removeProfileImage, location } = input;

            if (location) {
                if (location.latitude && !location.longitude) {
                    throw new GraphQLError('Longitude is required when latitude is provided', {
                        extensions: { code: 'BAD_USER_INPUT' },
                    });
                }
                if (location.longitude && !location.latitude) {
                    throw new GraphQLError('Latitude is required when longitude is provided', {
                        extensions: { code: 'BAD_USER_INPUT' },
                    });
                }
                if (location.latitude && location.longitude) {
                    updateData.latitude = location.latitude;
                    updateData.longitude = location.longitude;
                }
            }

            const user = await this.UserModel.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'NOT_FOUND' },
                });
            }

            if (user.onboardingStep !== 'COMPLETED') {
                throw new GraphQLError('Please complete the onboarding step', {
                    extensions: { code: 'ONBOARDING_NOT_COMPLETED' },
                });
            }

            const updateData = {};
            if (name !== undefined) updateData.name = name;
            if (bio !== undefined) updateData.bio = bio;

            // Handle image removal
            if (removeProfileImage && user.profileImageUrl) {
                try {
                    await fileUploadService.deleteFile(user.profileImageUrl);
                    updateData.profileImageUrl = null;
                    logger.info('Deleted profile image', {
                        userId,
                        oldImageUrl: user.profileImageUrl,
                    });
                } catch (err) {
                    logger.warn('Failed to delete existing profile image', {
                        userId,
                        imageUrl: user.profileImageUrl,
                        error: err.message,
                    });

                    if (!profileImage?.file) {
                        throw new GraphQLError('Failed to delete existing image', {
                            extensions: { code: 'FILE_DELETE_FAILED' },
                        });
                    }
                }
            }

            // Handle new profile image upload
            if (profileImage?.file) {
                try {
                    fileUploadService.validateImageFile(profileImage.file);

                    if (user.profileImageUrl) {
                        try {
                            await fileUploadService.deleteFile(user.profileImageUrl);
                            logger.info('Deleted previous profile image before new upload', {
                                userId,
                                oldImageUrl: user.profileImageUrl,
                            });
                        } catch (deleteErr) {
                            logger.warn('Failed to delete previous image', {
                                userId,
                                error: deleteErr.message,
                            });
                        }
                    }

                    uploadedFileUrl = await fileUploadService.uploadFile(profileImage.file, 'profile-images');
                    updateData.profileImageUrl = uploadedFileUrl;

                    logger.info('New profile image uploaded', {
                        userId,
                        imageUrl: uploadedFileUrl,
                    });
                } catch (uploadErr) {
                    logger.error('Profile image upload failed', {
                        userId,
                        error: uploadErr.message,
                    });
                    throw new GraphQLError('Failed to upload profile image', {
                        extensions: { code: 'FILE_UPLOAD_FAILED' },
                    });
                }
            }

            // Handle geospatial location
            if (location && location?.latitude && location?.longitude) {
                updateData.location = location;
            }

            await user.update(updateData, { transaction });
            await transaction.commit();

            logger.info('User profile updated successfully', {
                userId,
                updatedFields: Object.keys(updateData),
            });

            return {
                success: true,
                user,
                message: 'Profile updated successfully',
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }

            // Cleanup image if failed during upload flow
            if (uploadedFileUrl) {
                try {
                    await fileUploadService.deleteFile(uploadedFileUrl);
                    logger.info('Rolled back uploaded profile image', {
                        userId,
                        imageUrl: uploadedFileUrl,
                    });
                } catch (cleanupErr) {
                    logger.warn('Rollback image cleanup failed', {
                        userId,
                        imageUrl: uploadedFileUrl,
                        error: cleanupErr.message,
                    });
                }
            }

            logger.error('Unexpected error during profile update', {
                userId,
                error: error.message,
            });

            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to update user profile', {
                extensions: { code: 'INTERNAL_SERVER_ERROR' },
            });
        }
    }

    async updateNotificationSettings(userId, deviceId, input) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info('Updating notification settings', { userId });

            const user = await this.UserModel.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError('Account not found. Please log in again.', {
                    extensions: { code: 'NOT_FOUND' },
                });
            }

            if (input.pushNotifications === true && !input.fcmToken) {
                throw new GraphQLError('Please allow notifications on your device.', {
                    extensions: { code: 'FCM_TOKEN_REQUIRED' },
                });
            }

            const updateData = {};
            if (typeof input.pushNotifications === 'boolean') {
                updateData.pushNotificationsEnabled = input.pushNotifications;
            }
            if (typeof input.emailNotifications === 'boolean') {
                updateData.emailNotificationsEnabled = input.emailNotifications;
            }
            if (typeof input.communityUpdates === 'boolean') {
                updateData.communityUpdatesEnabled = input.communityUpdates;
            }
            if (typeof input.eventReminders === 'boolean') {
                updateData.eventRemindersEnabled = input.eventReminders;
            }

            if (Object.keys(updateData).length === 0 && !input.fcmToken) {
                throw new GraphQLError('Nothing to update.', {
                    extensions: { code: 'NO_FIELDS_TO_UPDATE' },
                });
            }

            if (Object.keys(updateData).length > 0) {
                await user.update(updateData, { transaction });
            }

            // Update or clear FCM token depending on setting
            if (input.fcmToken) {
                const [updated] = await this.AuthSession.update(
                    { fcmToken: input.fcmToken },
                    { where: { userId, deviceId }, transaction }
                );

                if (updated === 0) {
                    throw new GraphQLError('Could not update device token. Please try again.', {
                        extensions: { code: 'SESSION_NOT_FOUND' },
                    });
                }
            }

            if (input.pushNotifications === false) {
                await this.AuthSession.update(
                    { fcmToken: null },
                    { where: { userId, deviceId }, transaction }
                );
            }

            await transaction.commit();

            logger.info('Notification settings updated', {
                userId,
                updatedFields: Object.keys(updateData),
            });

            return {
                success: true,
                notificationSettings: {
                    pushNotifications: user.pushNotificationsEnabled,
                    emailNotifications: user.emailNotificationsEnabled,
                    communityUpdates: user.communityUpdatesEnabled,
                    eventReminders: user.eventRemindersEnabled,
                },
                message: 'Settings updated.',
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('Error updating notification settings', {
                userId,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Could not update settings. Please try again.', {
                extensions: { code: 'INTERNAL_SERVER_ERROR' },
            });
        }
    }

    async deleteAccount(userId, reason) {
        const transaction = await this.sequelize.transaction();
        try {
            logger.info('Scheduling account deletion', { userId });
            if(reason.length > 300){
                throw new GraphQLError('Reason is too long. Maximum 300 characters allowed',{
                    extensions: { code: "INVALID_REASON_LENGTH"}
                })
            }
            const user = await this.UserModel.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'NOT_FOUND' },
                });
            }
            if (user.deletedAt) {
                throw new GraphQLError('Account is already scheduled for deletion', {
                    extensions: { code: 'ALREADY_SCHEDULED' },
                });
            }

            if (user.onboardingStep !== 'COMPLETED') {
                throw new GraphQLError('Please complete the onboarding step', {
                    extensions: { code: 'ONBOARDING_NOT_COMPLETED' },
                });
            }

            const scheduledDeletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
            await user.update({
                isActive: false,
                deletedAt: scheduledDeletionDate,
                suspensionReason: reason || 'User requested account deletion',
            }, { transaction });

            await this.AuthSession.update(
                { isActive: false },
                { where: { userId }, transaction }
            );

            await transaction.commit();
            logger.info('Account deletion scheduled', {
                userId,
                scheduledDeletionDate,
                reason: reason || 'User requested account deletion',
            });
            return {
                success: true,
                message: 'Account scheduled for deletion',
                scheduledDeletionDate,
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('Error during account deletion scheduling', {
                userId,
                error: error.message,
            });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to schedule account deletion', {
                extensions: { code: 'INTERNAL_SERVER_ERROR' },
            });
        }
    }      
}

module.exports = new UserService()