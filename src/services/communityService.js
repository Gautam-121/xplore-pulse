const db = require("../config/dbConfig")
const Community = db.Community
const CommunityMember = db.CommunityMember
const CommunityPost = db.CommunityPost
const PostLike = db.PostLike
const PostBookmark = db.PostBookmark
const CommunityInterest = db.CommunityInterest
const EventRegistration = db.EventRegistration
const User = db.User
const Interest = db.Interest
const sequelize = db.sequelize
const fileUploadService = require("./fileUploadService")
const mailerService = require('./mailerService');
const { Op, Sequelize } = require("sequelize")
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');

const communityService = {
    
    // Helper methods with improved validation
    validateInput(input, requiredFields) {
        if (!input || typeof input !== 'object') {
            throw new GraphQLError('Invalid input object', {
                extensions: { code: "BAD_REQUEST_INPUT"}
            });
        }
        
        for (const field of requiredFields) {
            if (!input[field] || (typeof input[field] === 'string' && !input[field].trim())) {
                throw new GraphQLError(`${field} is required`, {
                    extensions: { code: "BAD_REQUEST_INPUT", field }
                });
            }
        }
    },

    validateUUID(uuid, fieldName) {
        if (!uuid || typeof uuid !== 'string') {
            throw new GraphQLError(`${fieldName} must be a valid string`, {
                extensions: { code: "BAD_REQUEST_INPUT", field: fieldName }
            });
        }
        
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
            throw new GraphQLError(`Invalid ${fieldName} format`, {
                extensions: { code: "BAD_REQUEST_INPUT", field: fieldName }
            });
        }
    },

    validateLocation(location) {
        if (!location || typeof location !== 'object') {
            throw new GraphQLError('Location must be an object with latitude and longitude', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'location' }
            });
        }
        
        if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
            throw new GraphQLError('Latitude and longitude must be numbers', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'location' }
            });
        }

        if (location.latitude < -90 || location.latitude > 90) {
            throw new GraphQLError('Latitude must be between -90 and 90', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'latitude' }
            });
        }

        if (location.longitude < -180 || location.longitude > 180) {
            throw new GraphQLError('Longitude must be between -180 and 180', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'longitude' }
            });
        }
    },

    // Helper method for slug sanitization with improved validation
    sanitizeSlug(name) {
        if (!name || typeof name !== 'string') {
            throw new GraphQLError('Name must be a valid string for slug generation', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'name' }
            });
        }
        
        return name
          .toLowerCase()
          .trim()
          .normalize('NFD') // Decompose accented characters
          .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
          .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .replace(/-+/g, '-') // Replace multiple hyphens with single
          .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
          .substring(0, 50); // Limit length
    },

    // Method 7: Hybrid Approach (Recommended) with improved error handling
    async generateUniqueSlugHybrid(name, providedSlug, transaction) {
        let baseSlug;

        if (providedSlug) {
            if (!/^[a-z0-9-]+$/.test(providedSlug)) {
                throw new GraphQLError('Slug can only contain lowercase letters, numbers, and hyphens', {
                    extensions: { code: "BAD_REQUEST_INPUT", field: 'slug' }
                });
            }
            baseSlug = providedSlug;
        } else {
            baseSlug = this.sanitizeSlug(name);
        }

        if (!baseSlug) {
            throw new GraphQLError('Invalid community name for slug generation', {
                extensions: { code: "BAD_REQUEST_INPUT", field: 'name' }
            });
        }

        try {
            // Step 1: Quick check if base slug is available
            const existingSlug = await Community.findOne({
                where: { slug: baseSlug },
                attributes: ['id'],
                transaction
            });

            if (!existingSlug) {
                return baseSlug;
            }

            // Step 2: If base slug exists, try a few sequential numbers
            const quickChecks = [];
            for (let i = 1; i <= 5; i++) {
                quickChecks.push(`${baseSlug}-${i}`);
            }

            const conflictingSlugs = await Community.findAll({
                where: {
                    slug: {
                        [Op.in]: quickChecks
                    }
                },
                attributes: ['slug'],
                transaction,
                raw: true
            });

            const conflictSet = new Set(conflictingSlugs.map(row => row.slug));

            // Return first available from quick checks
            for (const slug of quickChecks) {
                if (!conflictSet.has(slug)) {
                    return slug;
                }
            }

            // Step 3: If all quick checks fail, use timestamp/UUID approach
            const timestamp = Date.now().toString(36);
            return `${baseSlug}-${timestamp}`;
        } catch (error) {
            logger.error('Error generating unique slug', { error, name, providedSlug });
            throw new GraphQLError('Failed to generate unique slug', {
                extensions: { code: "SLUG_GENERATION_FAILED" }
            });
        }
    },

    /**
     * Discover communities with robust validation, error handling, and edge case handling.
     * @param {Object} params
     * @param {string} params.userId - User UUID
     * @param {number} params.limit - Page size
     * @param {string} [params.cursor] - Pagination cursor (base64)
     * @param {Object} [params.filters] - Filtering options
     * @returns {Promise<{edges: Array, pageInfo: Object}>}
     */
    async discoverCommunities({ userId, limit, cursor, filters }) {
        const VALID_SORT_BY = ['CREATED_AT', 'MEMBER_COUNT', 'ACTIVITY', 'DISTANCE', 'RELEVANCE'];
        const VALID_SORT_ORDER = ['ASC', 'DESC'];
        const DEFAULT_LIMIT = 20;
        const MAX_LIMIT = 100;
        let transaction;
        
        try {
            // Validate userId
            if (!userId) {
                throw new GraphQLError('Missing userId', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'userId' } });
            }
            this.validateUUID(userId, 'userId');

            // Validate limit
            let pageSize = DEFAULT_LIMIT;
            if (limit !== undefined) {
                if (typeof limit !== 'number' || isNaN(limit) || limit <= 0) {
                    throw new GraphQLError('limit must be a positive integer', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' } });
                }
                pageSize = Math.min(limit, MAX_LIMIT);
            }

            // Validate filters
            filters = filters || {};
            if (filters.radius !== undefined && (typeof filters.radius !== 'number' || filters.radius < 0)) {
                throw new GraphQLError('radius must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'radius' } });
            }
            if (filters.memberCountMin !== undefined && (typeof filters.memberCountMin !== 'number' || filters.memberCountMin < 0)) {
                throw new GraphQLError('memberCountMin must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'memberCountMin' } });
            }
            if (filters.memberCountMax !== undefined && (typeof filters.memberCountMax !== 'number' || filters.memberCountMax < 0)) {
                throw new GraphQLError('memberCountMax must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'memberCountMax' } });
            }
            if (filters.sortBy && !VALID_SORT_BY.includes(filters.sortBy)) {
                throw new GraphQLError(`Invalid sortBy: ${filters.sortBy}`, { extensions: { code: 'BAD_REQUEST_INPUT', field: 'sortBy' } });
            }
            if (filters.sortOrder && !VALID_SORT_ORDER.includes(filters.sortOrder)) {
                throw new GraphQLError(`Invalid sortOrder: ${filters.sortOrder}`, { extensions: { code: 'BAD_REQUEST_INPUT', field: 'sortOrder' } });
            }

            // Start transaction
            transaction = await sequelize.transaction();

            // Check user existence
            const user = await User.findByPk(userId, { transaction });
            if (!user) {
                throw new GraphQLError('User not found', { extensions: { code: 'USER_NOT_FOUND' } });
            }

            // Build query
            const where = {};
            if (filters.interests && Array.isArray(filters.interests) && filters.interests.length > 0) {
                where['$interests.id$'] = { [Op.in]: filters.interests };
            }
            if (filters.isPaid !== undefined) {
                where.isPaid = filters.isPaid;
            }
            if (filters.isPrivate !== undefined) {
                where.isPrivate = filters.isPrivate;
            }
            if (filters.memberCountMin !== undefined) {
                where.memberCount = { ...(where.memberCount || {}), [Op.gte]: filters.memberCountMin };
            }
            if (filters.memberCountMax !== undefined) {
                where.memberCount = { ...(where.memberCount || {}), [Op.lte]: filters.memberCountMax };
            }

            // Exclude communities user is already a member of
            const userMemberships = await CommunityMember.findAll({
                where: {
                    userId,
                    status: { [Op.in]: ['MEMBER', 'PENDING'] }
                },
                attributes: ['communityId'],
                raw: true,
                transaction
            });
            const excludedCommunityIds = userMemberships.map(m => m.communityId);
            if (excludedCommunityIds.length > 0) {
                where.id = { ...(where.id || {}), [Op.notIn]: excludedCommunityIds };
            }

            // Cursor-based pagination
            let cursorCondition = {};
            let decodedCursor = null;
            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
                    decodedCursor = JSON.parse(decoded);
                    if (!decodedCursor.id || !decodedCursor.createdAt) throw new Error('Invalid cursor');
                    cursorCondition = {
                        [Op.or]: [
                            { createdAt: { [Op.lt]: decodedCursor.createdAt } },
                            {
                                createdAt: decodedCursor.createdAt,
                                id: { [Op.lt]: decodedCursor.id }
                            }
                        ]
                    };
                } catch (err) {
                    throw new GraphQLError('Malformed cursor', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'cursor' } });
                }
            }

            // Sorting
            let order = [['createdAt', 'DESC']];
            if (filters.sortBy) {
                switch (filters.sortBy) {
                    case 'MEMBER_COUNT':
                        order = [['memberCount', filters.sortOrder === 'ASC' ? 'ASC' : 'DESC']];
                        break;
                    case 'ACTIVITY':
                        order = [['lastActivityAt', 'DESC']];
                        break;
                    default:
                        order = [['createdAt', 'DESC']];
                }
            }

            // Query communities
            const communities = await Community.findAll({
                where: { ...where, ...cursorCondition },
                order,
                limit: pageSize + 1,
                include: [
                    { model: User, as: 'owner', attributes: ['id', 'name', 'profileImageUrl'] },
                    { model: Interest, as: 'interests', attributes: ['id', 'name', 'category', 'icon'] }
                ],
                transaction
            });

            // Pagination logic
            const hasNextPage = communities.length > pageSize;
            const paginatedCommunities = hasNextPage ? communities.slice(0, pageSize) : communities;
            const edges = paginatedCommunities.map(community => ({
                node: community,
                cursor: Buffer.from(JSON.stringify({ id: community.id, createdAt: community.createdAt })).toString('base64')
            }));

            // Total count (for this filter)
            const totalCount = await Community.count({ where, transaction });

            await transaction.commit();
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('Error in discoverCommunities', { error, userId, limit, cursor, filters });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to discover communities', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
        }
    },

    async cleanupUploadedFiles(...fileUrls) {
        const cleanupPromises = fileUrls
          .filter(url => url) // Remove null/undefined URLs
          .map(async (url) => {
            try {
              await fileUploadService.deleteFile(url);
              logger.info('Successfully cleaned up file', { url });
            } catch (error) {
              logger.error('Failed to cleanup file', { url, error: error.message });
            }
          });
        
        await Promise.all(cleanupPromises);
    },
  
    async createCommunity(input) {
        const transaction = await sequelize.transaction();
        let uploadedImageUrl = null;
        let uploadedCoverImageUrl = null;
        const uploadPromises = [];
        
        try {
            logger.info('Starting community creation', { ownerId: input.ownerId, name: input.name });
            
            // Validate required input
            this.validateInput(input, ['name', 'description', 'ownerId']);
            this.validateUUID(input.ownerId, 'ownerId');
            this.validateLocation(input.location);
            
            // Check if owner exists and is active
            const owner = await User.findByPk(input.ownerId, { transaction });
            if (!owner) {
                logger.warn('Owner not found during community creation', { ownerId: input.ownerId });
                throw new GraphQLError('Owner not found', {
                    extensions: { code: "OWNER_NOT_FOUND" }
                });
            }
            if (!owner.isActive) {
                logger.warn('Owner account is not active', { ownerId: input.ownerId });
                throw new GraphQLError('Owner account is not active', {
                    extensions: { code: "ACCOUNT_DEACTIVATE" }
                });
            }

            // Handle file uploads with improved error handling
            if (input.imageFile) {
                logger.info('Validating and uploading community profile image', { ownerId: input.ownerId });
                try {
                    fileUploadService.validateImageFile(input.imageFile, 5); // 5MB limit
                    uploadPromises.push(
                        fileUploadService.uploadFile(input.imageFile, 'communities/profiles')
                            .then(url => {
                                uploadedImageUrl = url;
                                logger.info('Community profile image uploaded', { url });
                            })
                            .catch(error => {
                                logger.error('Failed to upload profile image', { error, ownerId: input.ownerId });
                                throw new GraphQLError('Failed to upload profile image', {
                                    extensions: { code: 'FILE_UPLOAD_FAILED' }
                                });
                            })
                    );
                } catch (error) {
                    logger.error('Profile image validation failed', { error, ownerId: input.ownerId });
                    throw new GraphQLError('Invalid profile image', {
                        extensions: { code: 'INVALID_FILE' }
                    });
                }
            }

            if (input.coverImageFile) {
                logger.info('Validating and uploading community cover image', { ownerId: input.ownerId });
                try {
                    fileUploadService.validateImageFile(input.coverImageFile, 10); // 10MB limit for cover
                    uploadPromises.push(
                        fileUploadService.uploadFile(input.coverImageFile, 'communities/covers')
                            .then(url => {
                                uploadedCoverImageUrl = url;
                                logger.info('Community cover image uploaded', { url });
                            })
                            .catch(error => {
                                logger.error('Failed to upload cover image', { error, ownerId: input.ownerId });
                                throw new GraphQLError('Failed to upload cover image', {
                                    extensions: { code: 'FILE_UPLOAD_FAILED' }
                                });
                            })
                    );
                } catch (error) {
                    logger.error('Cover image validation failed', { error, ownerId: input.ownerId });
                    throw new GraphQLError('Invalid cover image', {
                        extensions: { code: 'INVALID_FILE' }
                    });
                }
            }

            // Wait for all uploads to complete
            if (uploadPromises.length > 0) {
                await Promise.all(uploadPromises);
                logger.info('All image uploads completed', { uploadedImageUrl, uploadedCoverImageUrl });
            }

            // Generate and validate slug
            const slug = await this.generateUniqueSlugHybrid(
                input.name,
                input.slug,
                transaction
            );
            logger.info('Generated unique slug for community', { slug });

            // Validate interests exist
            if (input.interests && input.interests.length > 0) {
                const interestCount = await Interest.count({
                    where: { id: { [Op.in]: input.interests } },
                    transaction
                });

                if (interestCount !== input.interests.length) {
                    logger.warn('One or more interests not found', { inputInterests: input.interests });
                    throw new GraphQLError('One or more interests not found', {
                        extensions: { code: "INTEREST_NOT_FOUND" }
                    });
                }
            }

            // Prepare community data
            const communityData = {
                name: input.name.trim(),
                description: input.description.trim(),
                slug,
                imageUrl: uploadedImageUrl,
                coverImageUrl: uploadedCoverImageUrl,
                isPrivate: input.isPrivate || false,
                isPaid: input.isPaid || false,
                price: input.isPaid ? input.price : null,
                currency: input.isPaid ? (input.currency || 'USD') : null,
                ownerId: input.ownerId,
                memberCount: 1, // Owner is the first member
                postCount: 0,
                eventCount: 0,
                latitude: input.location.latitude,
                longitude: input.location.longitude,
            };
            logger.info('Creating community in database', { communityData });

            // Create community
            const community = await Community.create(communityData, { transaction });
            logger.info('Community created in database', { communityId: community.id });
            
            // Add owner as member with OWNER role
            await CommunityMember.create({
                userId: input.ownerId,
                communityId: community.id,
                role: 'OWNER',
                status: 'APPROVED',
                joinedAt: new Date(),
                requestedAt: new Date()
            }, { transaction });
            logger.info('Owner added as community member', { communityId: community.id, ownerId: input.ownerId });

            // Associate interests
            if (input.interests && input.interests.length > 0) {
                const interests = await Interest.findAll({
                    where: { id: { [Op.in]: input.interests } },
                    transaction
                });
                await community.setInterests(interests, { transaction });
                logger.info('Interests associated with community', { communityId: community.id, interests: input.interests });
            }

            // Update user's owned communities count
            await User.increment('ownedCommunitiesCount', {
                where: { id: input.ownerId },
                transaction
            });
            logger.info('Incremented user ownedCommunitiesCount', { ownerId: input.ownerId });

            // Fetch the complete community with all relations
            const completeCommunity = await Community.findByPk(community.id, {
                include: [
                    { model: User, as: 'owner' },
                    { model: Interest, as: 'interests' },
                    { model: User, as: 'admins', through: { where: { role: 'ADMIN', status: 'APPROVED' } } },
                    { model: User, as: 'moderators', through: { where: { role: 'MODERATOR', status: 'APPROVED' } } }
                ],
                transaction 
            });
            logger.info('Fetched complete community with relations', { communityId: community.id });

            // Set computed properties
            completeCommunity.isOwner = completeCommunity.ownerId === input.ownerId;
            completeCommunity.isAdmin = await this.isAdmin(completeCommunity.id, input.ownerId, transaction);
            completeCommunity.isModerator = await this.isModerator(completeCommunity.id, input.ownerId, transaction);
            completeCommunity.canCreateEvents = await this.canCreateEvents(completeCommunity.id, input.ownerId, transaction);
            completeCommunity.canPost = await this.canPost(completeCommunity.id, input.ownerId, transaction);
            completeCommunity.membershipStatus = await this.getMembershipStatus(completeCommunity.id, input.ownerId, transaction);

            await transaction.commit();
            logger.info('Community creation transaction committed', { communityId: community.id });
            return completeCommunity;

        } catch (error) {
            logger.error('Error during community creation', { error, ownerId: input.ownerId, name: input.name });
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('Community creation transaction rolled back', { ownerId: input.ownerId, name: input.name });
            }

            // Clean up uploaded files on error
            try {
                await this.cleanupUploadedFiles(uploadedImageUrl, uploadedCoverImageUrl);
                logger.info('Cleaned up uploaded files after error', { uploadedImageUrl, uploadedCoverImageUrl });
            } catch (cleanupError) {
                logger.error('Failed to cleanup uploaded files after error', { cleanupError, uploadedImageUrl, uploadedCoverImageUrl });
            }
            
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to create community', {
                extensions: { code: 'COMMUNITY_CREATE_FAILED', originalError: error.message }
            });
        }
    },
  
    async joinCommunity(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('User attempting to join community', { communityId, userId });
            
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in joinCommunity', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }
            
            this.validateUUID(communityId, 'communityId');
            this.validateUUID(userId, 'userId');

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in joinCommunity', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find existing membership (any status)
            const existingMembership = await CommunityMember.findOne({
                where: { userId, communityId },
                transaction
            });

            if (existingMembership) {
                if (existingMembership.status === 'APPROVED') {
                    logger.warn('User already a member in joinCommunity', { communityId, userId });
                    throw new GraphQLError('You are already a member', {
                        extensions: { code: 'ALREADY_MEMBER' }
                    });
                }
                if (existingMembership.status === 'PENDING') {
                    logger.warn('User has pending request in joinCommunity', { communityId, userId });
                    throw new GraphQLError('You have a pending request', {
                        extensions: { code: 'PENDING_MEMBER' }
                    });
                }
                if (existingMembership.status === 'BANNED') {
                    logger.warn('Banned user attempted to join community', { communityId, userId });
                    throw new GraphQLError('You have been banned from this community.', {
                        extensions: { code: 'BANNED' }
                    });
                }
                if (existingMembership.status === 'REJECTED') {
                    logger.warn('Rejected user attempted to re-join community', { communityId, userId });
                    throw new GraphQLError('Your request to join this community was rejected.', {
                        extensions: { code: 'REJECTED' }
                    });
                    // Option 2: Allow re-request (uncomment if you want to allow)
                    // existingMembership.status = community.isPrivate ? 'PENDING' : 'APPROVED';
                    // existingMembership.requestedAt = new Date();
                    // existingMembership.joinedAt = community.isPrivate ? null : new Date();
                    // await existingMembership.save({ transaction });
                    // if (!community.isPrivate) {
                    //     await Community.increment('memberCount', { by: 1, where: { id: communityId }, transaction });
                    // }
                    // if (community.isPrivate) {
                    //     await this.notifyAdminsOfNewRequest(communityId, userId, transaction);
                    // }
                    // await transaction.commit();
                    // return {
                    //     success: true,
                    //     message: community.isPrivate
                    //         ? 'Join request sent. Awaiting approval from the community owner.'
                    //         : 'Successfully re-joined the community'
                    // };
                }
                // Optionally handle other statuses here
                throw new GraphQLError('You cannot join this community at this time.', {
                    extensions: { code: 'CANNOT_JOIN' }
                });
            }

            // 5. Handle paid communities
            if (community.isPaid) {
                logger.info('User attempting to join paid community', { communityId, userId, price: community.price });
                throw new GraphQLError('This is a paid community. Please complete payment to join.', {
                    extensions: { code: 'PAYMENT_REQUIRED' }
                });
            }

            // 6. Determine membership status
            let membershipStatus = 'APPROVED';
            let joinedAt = new Date();
            let requestedAt = new Date();
            let message = 'Successfully joined the community';

            if (community.isPrivate) {
                membershipStatus = 'PENDING';
                joinedAt = null;
                message = 'Join request sent. Awaiting approval from the community owner.';
                // Notify admins/owner
                await this.notifyAdminsOfNewRequest(communityId, userId, transaction);
            }

            // 7. Create the membership
            await CommunityMember.create({
                userId,
                communityId,
                role: 'MEMBER',
                status: membershipStatus,
                requestedAt,
                joinedAt
            }, { transaction });

            // 8. If immediately approved, increment member count
            if (membershipStatus === 'APPROVED') {
                await Community.increment('memberCount', {
                    by: 1,
                    where: { id: communityId },
                    transaction
                });
            }

            await transaction.commit();
            logger.info('User successfully joined community', { communityId, userId, status: membershipStatus });
            return {
                success: true,
                message
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('joinCommunity transaction rolled back', { communityId, userId });
            }
            logger.error('Error in joinCommunity', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to join community', {
                extensions: { code: 'JOIN_COMMUNITY_FAILED', originalError: error.message }
            });
        }
    },
  
    async approveMemberRequest(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Approving member request', { communityId, userId });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in approveMemberRequest', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in approveMemberRequest', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership request not found in approveMemberRequest', { communityId, userId });
                throw new GraphQLError('Membership request not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Check if already approved or not pending
            if (membership.status === 'APPROVED') {
                logger.warn('Membership already approved in approveMemberRequest', { communityId, userId });
                throw new GraphQLError('User is already a member of the community', {
                    extensions: { code: 'ALREADY_MEMBER' }
                });
            }
            if (membership.status === 'BANNED') {
                logger.warn('Attempt to approve banned member in approveMemberRequest', { communityId, userId });
                throw new GraphQLError('User is banned from this community and cannot be approved.', {
                    extensions: { code: 'BANNED' }
                });
            }
            if (membership.status === 'REJECTED') {
                logger.warn('Attempt to approve rejected member in approveMemberRequest', { communityId, userId });
                throw new GraphQLError('Membership request was rejected and cannot be approved.', {
                    extensions: { code: 'REJECTED' }
                });
            }
            if (membership.status !== 'PENDING') {
                logger.warn('Membership request is not pending in approveMemberRequest', { communityId, userId, status: membership.status });
                throw new GraphQLError('Membership request is not pending', {
                    extensions: { code: 'NOT_PENDING' }
                });
            }

            // 5. Approve the membership
            try {
                membership.status = 'APPROVED';
                membership.joinedAt = new Date();
                await membership.save({ transaction });
            } catch (saveErr) {
                logger.error('Failed to save approved membership in approveMemberRequest', { saveErr, communityId, userId });
                throw saveErr;
            }

            // 6. Increment member count
            try {
                await Community.increment('memberCount', {
                    by: 1,
                    where: { id: communityId },
                    transaction
                });
            } catch (incErr) {
                logger.error('Failed to increment member count in approveMemberRequest', { incErr, communityId });
                throw incErr;
            }

            // 7. Notify user of approval
            try {
                await this.notifyUserOfApproval(communityId, userId, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of approval in approveMemberRequest', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('Membership request approved successfully', { communityId, userId });
            return {
                success: true,
                message: 'Membership request approved successfully.'
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('approveMemberRequest transaction rolled back', { communityId, userId });
            }
            logger.error('Error in approveMemberRequest', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not approve member due to related records.', {
                    extensions: { code: 'APPROVE_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to approve member request', {
                extensions: { code: 'APPROVE_MEMBER_FAILED', originalError: error.message }
            });
        }
    },
  
    /**
     * Get paginated list of community wall posts with robust validation, error handling, and edge case handling.
     * @param {Object} params
     * @param {string} params.communityId - Community UUID
     * @param {string} params.userId - User UUID
     * @param {number} params.limit - Page size
     * @param {string} [params.cursor] - Pagination cursor (base64)
     * @param {string} [params.postType] - Filter by post type (TEXT, IMAGE, VIDEO, LINK, EVENT, EDUCATIONAL, POLL)
     * @returns {Promise<{edges: Array, pageInfo: Object}>}
     */
    async getCommunityWall({ communityId, userId, limit, cursor, postType }) {
        const VALID_POST_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'LINK', 'EVENT', 'EDUCATIONAL', 'POLL'];
        const DEFAULT_LIMIT = 20;
        const MAX_LIMIT = 100;
        let transaction;
        
        try {
            // Validate communityId and userId
            if (!communityId || typeof communityId !== 'string') {
                throw new GraphQLError('Missing or invalid communityId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'communityId' }
                });
            }
            
            this.validateUUID(communityId, 'communityId');
            this.validateUUID(userId, 'userId');
            
            // Validate limit
            let pageSize = DEFAULT_LIMIT;
            if (limit !== undefined) {
                if (typeof limit !== 'number' || isNaN(limit) || limit <= 0 || limit > MAX_LIMIT) {
                    throw new GraphQLError('limit must be a positive integer between 1 and 100', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' } });
                }
                pageSize = limit;
            }

            // Validate postType
            if (postType && !VALID_POST_TYPES.includes(postType)) {
                throw new GraphQLError(`Invalid postType: ${postType}`, { extensions: { code: 'BAD_REQUEST_INPUT', field: 'postType' } });
            }

            // Start transaction
            transaction = await sequelize.transaction();

            // Check community existence and user access
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                throw new GraphQLError('The community you are trying to access does not exist.', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND', field: 'communityId' }
                });
            }

            // Check user membership and access rights
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });

            if (!membership || membership.status !== 'APPROVED') {
                if (!membership) {
                    throw new GraphQLError('You need to join this community to access its content.', {
                        extensions: { code: 'NOT_A_MEMBER' }
                    });
                }
                if (membership.status === 'BANNED') {
                    throw new GraphQLError('You have been banned from this community.', {
                        extensions: { code: 'BANNED' }
                    });
                }
                if (membership.status === 'PENDING') {
                    throw new GraphQLError('Your request to join this community is still pending approval.', {
                        extensions: { code: 'PENDING' }
                    });
                }
                if (membership.status === 'REJECTED') {
                    throw new GraphQLError('Your request to join this community was rejected.', {
                        extensions: { code: 'REJECTED' }
                    });
                }
            }

            // Build query with proper access control
            const where = { communityId };
            if (postType) where.type = postType;
            
            // Cursor-based pagination
            let cursorCondition = {};
            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
                    const decodedCursor = JSON.parse(decoded);
                    if (!decodedCursor.id || !decodedCursor.createdAt) throw new Error('Invalid cursor');
                    // For stable pagination, use createdAt/id tuple
                    cursorCondition = {
                        [Op.or]: [
                            { createdAt: { [Op.lt]: decodedCursor.createdAt } },
                            {
                                createdAt: decodedCursor.createdAt,
                                id: { [Op.lt]: decodedCursor.id }
                            }
                        ]
                    };
                } catch (err) {
                    throw new GraphQLError('Malformed cursor', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'cursor' } });
                }
            }

            // Query posts with optimized includes
            const posts = await CommunityPost.findAll({
                where: { ...where, ...cursorCondition },
                order: [
                    ['createdAt', 'DESC'],
                    ['id', 'DESC']
                ],
                limit: pageSize + 1,
                include: [
                    { 
                        model: User, 
                        as: 'author', 
                        attributes: ['id', 'name', 'profileImageUrl', 'bio'],
                        required: false
                    },
                    { 
                        model: Community, 
                        as: 'community', 
                        attributes: ['id', 'name', 'slug'],
                        required: false
                    }
                ],
                transaction
            });

            // Pagination logic
            const hasNextPage = posts.length > pageSize;
            const paginatedPosts = hasNextPage ? posts.slice(0, pageSize) : posts;
            const edges = paginatedPosts.map(post => ({
                node: post,
                cursor: Buffer.from(JSON.stringify({ id: post.id, createdAt: post.createdAt })).toString('base64')
            }));

            // Total count (for this filter)
            const totalCount = await CommunityPost.count({ where, transaction });

            await transaction.commit();
            logger.info('Successfully fetched community wall', { communityId, userId, postCount: edges.length });
            
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage && edges.length > 0 ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            // Log error with context
            logger.error('getCommunityWall error', { error, communityId, userId, limit, cursor, postType });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch community wall', { extensions: { code: 'INTERNAL_SERVER_ERROR', originalError: error.message } });
        }
    },
  
    async createCommunityPost(data) {
      try {
        const post = new CommunityPost({
          ...data,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          createdAt: new Date()
        });
        
        await post.save();
        
        // Update community post count
        await Community.findByIdAndUpdate(data.communityId, {
          $inc: { postCount: 1 },
          lastActivityAt: new Date()
        });
        
        // If it's an event, update event count
        if (data.type === 'EVENT') {
          await Community.findByIdAndUpdate(data.communityId, {
            $inc: { eventCount: 1 }
          });
        }
        
        return await post.populate('author community');
      } catch (error) {
        console.error('Error creating community post:', error);
        throw error;
      }
    },
  
    async checkAdminAccess(communityId, userId) {
        if (!communityId || !userId) {
            throw new GraphQLError('Missing communityId or userId', {
                extensions: { code: 'BAD_REQUEST_INPUT' }
            });
        }
        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                role: { [Op.in]: ['OWNER', 'ADMIN'] },
                status: 'APPROVED'
            }
        });
        if (!membership) {
            throw new GraphQLError('Only community owners or admins can perform this action.', {
                extensions: { code: 'INSUFFICIENT_PERMISSIONS' }
            });
        }
        return true;
    },
  
    async checkOwnerAccess(communityId, userId) {
      const community = await Community.findByPk(communityId);
      if(!community){
        throw new GraphQLError('Community Not Found',{
            extensions: { code: "NOT_FOUND"}
        })
      }
      if (!community || community.ownerId !== userId) {
        throw new GraphQLError('Only community owner can perform this action',{
            extensions: { code: "UNAUTHORIZED_ACCESS"}
        })
      }
    },
  
    async getMembershipStatus(communityId, userId, transaction) {
        const membership = await CommunityMember.findOne({
            where: { userId, communityId },
            transaction
        });
        if (!membership) return 'NOT_MEMBER';
        switch (membership.status) {
            case 'APPROVED': return 'MEMBER';
            case 'PENDING': return 'PENDING';
            case 'REJECTED': return 'REJECTED';
            default: return 'NOT_MEMBER';
        }
    },

    async isAdmin(communityId, userId, transaction) {
        if (!userId) return false;
        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED',
                role: { [Op.in]: ['OWNER', 'ADMIN'] }
            },
            transaction
        });
        return !!membership;
    },

    async isModerator(communityId, userId, transaction) {
        if (!userId) return false;
        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED',
                role: { [Op.in]: ['OWNER', 'ADMIN', 'MODERATOR'] }
            },
            transaction
        });
        return !!membership;
    },

    async canPost(communityId, userId, transaction) {
        if (!userId) return false;
        try {
            await this.checkPostAccess(communityId, userId, transaction);
            return true;
        } catch {
            return false;
        }
    },

    async canCreateEvents(communityId, userId, transaction) {
        if (!userId) return false;
        const community = await Community.findByPk(communityId, { transaction });
        if (!community) return false;
        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED'
            },
            transaction
        });
        if (!membership) return false;
        if (!community.settings.allowMemberEvents && !['OWNER', 'ADMIN'].includes(membership.role)) {
            return false;
        }
        return true;
    },

    async checkPostAccess(communityId, userId, transaction) {
        // 1. Check if user is a member and get their role/status
        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED'
            },
            transaction
        });
        if (!membership) {
            throw new GraphQLError('You are not a member of this community', {
                extensions: { code: 'NOT_A_MEMBER' }
            });
        }
        // 2. Get the community and its settings
        const community = await Community.findByPk(communityId, { transaction });
        if (!community) {
            throw new GraphQLError('Community not found', {
                extensions: { code: 'COMMUNITY_NOT_FOUND' }
            });
        }
        // 3. Owners and Admins can always post
        if (['OWNER', 'ADMIN'].includes(membership.role)) {
            return true;
        }
        // 4. Moderators can post if you want (optional, or treat as members)
        if (membership.role === 'MODERATOR') {
            // If you want to restrict moderators, add logic here
            return true;
        }
        // 5. Members: check community settings
        if (membership.role === 'MEMBER') {
            if (community.settings && community.settings.allowMemberPosts) {
                return true;
            } else {
                return false
            }
        }
        // 6. Fallback: deny
        return false
    },

    /**
     * Search communities with robust validation, error handling, and edge case handling.
     * @param {Object} params
     * @param {string} params.userId - User UUID
     * @param {string} params.query - Search string
     * @param {number} params.limit - Page size
     * @param {string} [params.cursor] - Pagination cursor (base64)
     * @param {Object} [params.filters] - Filtering options
     * @returns {Promise<{edges: Array, pageInfo: Object}>}
     */
    async searchCommunities({ userId, query, limit, cursor, filters }) {
        const VALID_SORT_BY = ['CREATED_AT', 'MEMBER_COUNT', 'ACTIVITY', 'DISTANCE', 'RELEVANCE'];
        const VALID_SORT_ORDER = ['ASC', 'DESC'];
        const DEFAULT_LIMIT = 20;
        const MAX_LIMIT = 100;
        try {
            // Validate userId
            if (!userId) throw new GraphQLError('Missing userId', { extensions: { code: 'BAD_REQUEST_INPUT' } });
            this.validateUUID(userId, 'userId');

            // Validate query
            if (!query || typeof query !== 'string' || !query.trim()) {
                throw new GraphQLError('Search query is required', { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }

            // Validate limit
            let pageSize = DEFAULT_LIMIT;
            if (limit !== undefined) {
                if (typeof limit !== 'number' || isNaN(limit) || limit <= 0) {
                    throw new GraphQLError('limit must be a positive integer', { extensions: { code: 'BAD_REQUEST_INPUT' } });
                }
                pageSize = Math.min(limit, MAX_LIMIT);
            }

            // Validate filters
            filters = filters || {};
            if (filters.radius !== undefined && (typeof filters.radius !== 'number' || filters.radius < 0)) {
                throw new GraphQLError('radius must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }
            if (filters.memberCountMin !== undefined && (typeof filters.memberCountMin !== 'number' || filters.memberCountMin < 0)) {
                throw new GraphQLError('memberCountMin must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }
            if (filters.memberCountMax !== undefined && (typeof filters.memberCountMax !== 'number' || filters.memberCountMax < 0)) {
                throw new GraphQLError('memberCountMax must be a non-negative number', { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }
            if (filters.sortBy && !VALID_SORT_BY.includes(filters.sortBy)) {
                throw new GraphQLError(`Invalid sortBy: ${filters.sortBy}`, { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }
            if (filters.sortOrder && !VALID_SORT_ORDER.includes(filters.sortOrder)) {
                throw new GraphQLError(`Invalid sortOrder: ${filters.sortOrder}`, { extensions: { code: 'BAD_REQUEST_INPUT' } });
            }

            // Check user existence
            const user = await User.findByPk(userId);
            if (!user) throw new GraphQLError('User not found', { extensions: { code: 'USER_NOT_FOUND' } });

            // Build query
            const where = {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${query}%` } },
                    { description: { [Op.iLike]: `%${query}%` } }
                ]
            };
            if (filters.interests && Array.isArray(filters.interests) && filters.interests.length > 0) {
                where['$interests.id$'] = { [Op.in]: filters.interests };
            }
            if (filters.isPaid !== undefined) where.isPaid = filters.isPaid;
            if (filters.isPrivate !== undefined) where.isPrivate = filters.isPrivate;
            if (filters.memberCountMin !== undefined) {
                where.memberCount = { ...(where.memberCount || {}), [Op.gte]: filters.memberCountMin };
            }
            if (filters.memberCountMax !== undefined) {
                where.memberCount = { ...(where.memberCount || {}), [Op.lte]: filters.memberCountMax };
            }
            // Location filter (skip for now)

            // Exclude communities user is already a member of
            const userMemberships = await CommunityMember.findAll({
                where: {
                    userId,
                    status: { [Op.in]: ['MEMBER', 'PENDING'] }
                },
                attributes: ['communityId'],
                raw: true
            });
            const excludedCommunityIds = userMemberships.map(m => m.communityId);
            if (excludedCommunityIds.length > 0) {
                where.id = { ...(where.id || {}), [Op.notIn]: excludedCommunityIds };
            }

            // Cursor-based pagination
            let cursorCondition = {};
            let decodedCursor = null;
            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
                    decodedCursor = JSON.parse(decoded);
                    if (!decodedCursor.id || !decodedCursor.createdAt) throw new Error('Invalid cursor');
                    cursorCondition = {
                        [Op.or]: [
                            { createdAt: { [Op.lt]: decodedCursor.createdAt } },
                            {
                                createdAt: decodedCursor.createdAt,
                                id: { [Op.lt]: decodedCursor.id }
                            }
                        ]
                    };
                } catch (err) {
                    throw new GraphQLError('Malformed cursor', { extensions: { code: 'BAD_REQUEST_INPUT' } });
                }
            }

            // Sorting
            let order = [['createdAt', 'DESC']];
            if (filters.sortBy) {
                switch (filters.sortBy) {
                    case 'MEMBER_COUNT':
                        order = [['memberCount', filters.sortOrder === 'ASC' ? 'ASC' : 'DESC']];
                        break;
                    case 'ACTIVITY':
                        order = [['lastActivityAt', 'DESC']];
                        break;
                    // DISTANCE and RELEVANCE would require more complex logic
                    default:
                        order = [['createdAt', 'DESC']];
                }
            }

            // Query communities
            const communities = await Community.findAll({
                where: { ...where, ...cursorCondition },
                order,
                limit: pageSize + 1,
                include: [
                    { model: User, as: 'owner', attributes: ['id', 'name', 'profileImageUrl'] },
                    { model: Interest, as: 'interests', attributes: ['id', 'name', 'category', 'icon'] }
                ]
            });

            // Pagination logic
            const hasNextPage = communities.length > pageSize;
            const paginatedCommunities = hasNextPage ? communities.slice(0, pageSize) : communities;
            const edges = paginatedCommunities.map(community => ({
                node: community,
                cursor: Buffer.from(JSON.stringify({ id: community.id, createdAt: community.createdAt })).toString('base64')
            }));

            // Total count (for this filter)
            const totalCount = await Community.count({ where });

            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            // Log error for debugging, but do not leak details
            console.error('Error in searchCommunities:', error);
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to search communities', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
        }
    },
    
    /**
     * Get paginated list of community members with robust validation, error handling, and edge case handling.
     * @param {Object} params
     * @param {string} params.communityId - Community UUID
     * @param {number} params.limit - Page size
     * @param {string} [params.cursor] - Pagination cursor (base64)
     * @param {string} [params.role] - Filter by role (OWNER, ADMIN, MODERATOR, MEMBER)
     * @param {string} [params.status] - Filter by status (PENDING, APPROVED, REJECTED, BANNED)
     * @returns {Promise<{edges: Array, pageInfo: Object}>}
     */
    async getCommunityMembers({ communityId, limit, cursor, role, status }) {
        const VALID_ROLES = ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'];
        const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'BANNED'];
        const DEFAULT_LIMIT = 20;
        const MAX_LIMIT = 100;
        let transaction;
        try {
            // Validate communityId
            if (!communityId ) {
                throw new GraphQLError('Missing or invalid communityId', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'communityId' } });
            }

            // Validate limit
            let pageSize = DEFAULT_LIMIT;
            if (limit !== undefined) {
                if (typeof limit !== 'number' || isNaN(limit) || limit <= 0 || limit > MAX_LIMIT) {
                    throw new GraphQLError('limit must be a positive integer between 1 and 100', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' } });
                }
                pageSize = limit;
            }

            // Validate role
            if (role && !VALID_ROLES.includes(role)) {
                throw new GraphQLError(`Invalid role: ${role}`, { extensions: { code: 'BAD_REQUEST_INPUT', field: 'role' } });
            }
            // Validate status
            if (status && !VALID_STATUSES.includes(status)) {
                throw new GraphQLError(`Invalid status: ${status}`, { extensions: { code: 'BAD_REQUEST_INPUT', field: 'status' } });
            }

            // Start transaction
            transaction = await sequelize.transaction();

            // Check community existence
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                throw new GraphQLError('Community not found', { extensions: { code: 'NOT_FOUND', field: 'communityId' } });
            }

            // Build query
            const where = { communityId };
            if (role) where.role = role;
            if (status) where.status = status;
            // Cursor-based pagination
            let cursorCondition = {};
            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
                    const decodedCursor = JSON.parse(decoded);
                    if (!decodedCursor.id || !decodedCursor.joinedAt) throw new Error('Invalid cursor');
                    // For stable pagination, use joinedAt/id tuple
                    cursorCondition = {
                        [Op.or]: [
                            { joinedAt: { [Op.lt]: decodedCursor.joinedAt } },
                            {
                                joinedAt: decodedCursor.joinedAt,
                                id: { [Op.lt]: decodedCursor.id }
                            }
                        ]
                    };
                } catch (err) {
                    throw new GraphQLError('Malformed cursor', { extensions: { code: 'BAD_REQUEST_INPUT', field: 'cursor' } });
                }
            }

            // Query members
            const members = await CommunityMember.findAll({
                where: { ...where, ...cursorCondition },
                order: [
                    ['joinedAt', 'DESC'],
                    ['id', 'DESC']
                ],
                limit: pageSize + 1,
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'name', 'profileImageUrl', 'bio']
                    }
                ],
                transaction
            });

            // Pagination logic
            const hasNextPage = members.length > pageSize;
            const paginatedMembers = hasNextPage ? members.slice(0, pageSize) : members;
            const edges = paginatedMembers.map(member => ({
                node: member,
                cursor: Buffer.from(JSON.stringify({ id: member.id, joinedAt: member.joinedAt })).toString('base64')
            }));

            // Total count (for this filter)
            const totalCount = await CommunityMember.count({ where, transaction });

            await transaction.commit();
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage && edges.length > 0 ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            // Log error with context
            logger.error('getCommunityMembers error', { error, communityId, limit, cursor, role, status })
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch community members', { extensions: { code: 'INTERNAL_SERVER_ERROR', originalError: error.message } });
        }
    },
    
    async getTrendingCommunities({ userId, limit, timeframe }) {
        let transaction;
        try {
            logger.info('Fetching trending communities', { userId, limit, timeframe });
            
            // 1. Validate input
            if (limit !== undefined && (typeof limit !== 'number' || isNaN(limit) || limit < 1 || limit > 100)) {
                throw new GraphQLError('Limit must be a number between 1 and 100', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' }
                });
            }
            const allowedTimeframes = ['day', 'week', 'month'];
            if (timeframe && !allowedTimeframes.includes(timeframe)) {
                throw new GraphQLError('Invalid timeframe. Allowed: day, week, month', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'timeframe' }
                });
            }
            if (userId && typeof userId !== 'string') {
                throw new GraphQLError('Invalid userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'userId' }
                });
            }
            if (userId) {
                this.validateUUID(userId, 'userId');
            }
    
            // 2. Calculate timeframe start date
            const timeframeDate = new Date();
            switch (timeframe) {
                case 'day': timeframeDate.setDate(timeframeDate.getDate() - 1); break;
                case 'week': timeframeDate.setDate(timeframeDate.getDate() - 7); break;
                case 'month': timeframeDate.setMonth(timeframeDate.getMonth() - 1); break;
                default: timeframeDate.setDate(timeframeDate.getDate() - 7);
            }
    
            // 3. Start transaction
            transaction = await sequelize.transaction();
    
            // 4. Build base query conditions
            const whereConditions = { isPrivate: false };
            
            // Exclude communities user is already a member of (if userId provided)
            if (userId) {
                const userMemberships = await CommunityMember.findAll({
                    where: {
                        userId,
                        status: { [Op.in]: ['APPROVED', 'PENDING'] }
                    },
                    attributes: ['communityId'],
                    raw: true,
                    transaction
                });
                const excludedCommunityIds = userMemberships.map(m => m.communityId);
                if (excludedCommunityIds.length > 0) {
                    whereConditions.id = { [Op.notIn]: excludedCommunityIds };
                }
            }
    
            // 5. Query with aggregates and optimized includes
            const communities = await Community.findAll({
                where: whereConditions,
                include: [
                    {
                        model: CommunityPost,
                        attributes: [],
                        required: false,
                        where: { createdAt: { [Op.gte]: timeframeDate } }
                    },
                    {
                        model: CommunityMember,
                        attributes: [],
                        required: false,
                        where: {
                            joinedAt: { [Op.gte]: timeframeDate },
                            status: 'APPROVED'
                        }
                    },
                    {
                        model: User,
                        as: 'owner',
                        attributes: ['id', 'name', 'profileImageUrl'],
                        required: false
                    },
                    {
                        model: Interest,
                        as: 'interests',
                        attributes: ['id', 'name', 'category', 'icon'],
                        through: { attributes: [] },
                        required: false
                    }
                ],
                attributes: {
                    include: [
                        [Sequelize.fn('COUNT', Sequelize.col('CommunityPosts.id')), 'recentPosts'],
                        [Sequelize.fn('COUNT', Sequelize.col('CommunityMembers.id')), 'recentMembers'],
                        [
                            Sequelize.literal(
                                '(COUNT("CommunityPosts"."id") * 2 + COUNT("CommunityMembers"."id") * 5 + "Community"."memberCount" / 10)'
                            ),
                            'trendingScore'
                        ]
                    ]
                },
                group: ['Community.id', 'owner.id', 'interests.id', 'interests->CommunityInterest.communityId', 'interests->CommunityInterest.interestId'],
                order: [[Sequelize.literal('"trendingScore"'), 'DESC']],
                limit: limit || 10,
                transaction
            });
    
            await transaction.commit();
            
            const result = communities.map(c => {
                const plain = c.get({ plain: true });
                return {
                    ...plain,
                    trendingScore: parseFloat(plain.trendingScore) || 0,
                    recentPosts: parseInt(plain.recentPosts) || 0,
                    recentMembers: parseInt(plain.recentMembers) || 0
                };
            });
            
            logger.info('Successfully fetched trending communities', { count: result.length, timeframe });
            return result;
            
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('getTrendingCommunities error', { error, userId, limit, timeframe });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch trending communities', {
                extensions: { code: 'TRENDING_COMMUNITIES_FAILED', originalError: error.message }
            });
        }
    },
    
    async getRecommendedCommunities({ userId, limit, maxDistance = 50 }) {
        let transaction;
        try {
            logger.info('Fetching recommended communities', { userId, limit, maxDistance });
            
            // 1. Validate input
            if (!userId) {
                throw new GraphQLError('Missing or invalid userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'userId' }
                });
            }
            this.validateUUID(userId, 'userId');
            
            if (typeof limit !== 'number' || isNaN(limit) || limit < 1 || limit > 100) {
                throw new GraphQLError('Limit must be a number between 1 and 100', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' }
                });
            }
            if (typeof maxDistance !== 'number' || isNaN(maxDistance) || maxDistance < 1 || maxDistance > 1000) {
                throw new GraphQLError('Max distance must be a number between 1 and 1000 kilometers', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'maxDistance' }
                });
            }
    
            // 2. Start transaction
            transaction = await sequelize.transaction();
    
            // 3. Fetch user and their interests
            const user = await User.findByPk(userId, {
                include: [{ model: Interest, as: 'interests', attributes: ['id'] }],
                transaction
            });
            if (!user) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'USER_NOT_FOUND', field: 'userId' }
                });
            }
            
            const userInterestIds = user.interests.map(i => i.id);
            if (!userInterestIds.length) {
                // No interests, return popular communities
                logger.info('User has no interests, returning popular communities', { userId });
                const data = await this.getPopularCommunities({ excludedIds: [], limit, transaction });
                await transaction.commit();
                return data;
            }
    
            // 4. Get all community IDs where the user is already a member or has a pending request
            const userMemberships = await CommunityMember.findAll({
                where: {
                    userId,
                    status: { [Op.in]: ['APPROVED', 'PENDING'] }
                },
                attributes: ['communityId'],
                transaction
            });
            const excludedIds = userMemberships.map(m => m.communityId);
    
            // 5. Check if user has location data for location-based recommendations
            const hasUserLocation = user.latitude && user.longitude;
            let recommendations;
    
            if (hasUserLocation) {
                // Location-based recommendations
                logger.info('Using location-based recommendations', { userId, hasUserLocation });
                recommendations = await this.getLocationBasedRecommendations({
                    user,
                    userInterestIds,
                    excludedIds,
                    maxDistance,
                    limit,
                    transaction
                });
            } else {
                // Interest-based recommendations only
                logger.info('Using interest-based recommendations', { userId, interestCount: userInterestIds.length });
                recommendations = await this.getInterestBasedRecommendations({
                    userInterestIds,
                    excludedIds,
                    limit,
                    transaction
                });
            }
    
            await transaction.commit();
            logger.info('Successfully fetched recommended communities', { userId, count: recommendations.length });
            return recommendations;
    
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('getRecommendedCommunities error', { error, userId, limit, maxDistance });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch recommended communities', {
                extensions: { code: 'RECOMMENDED_COMMUNITIES_FAILED', originalError: error.message }
            });
        }
    },
    
      /**
       * Get location-based recommendations using distance calculations
       */
      async getLocationBasedRecommendations({ user, userInterestIds, excludedIds, maxDistance, limit, transaction }) {
        try {
          const { latitude: userLat, longitude: userLng } = user;
    
          // Build where conditions for communities
          const whereConditions = {
            id: excludedIds.length ? { [Op.notIn]: excludedIds } : { [Op.ne]: null },
            isPrivate: false,
            latitude: { [Op.not]: null },
            longitude: { [Op.not]: null }
          };
    
          // Find communities with distance calculation
          const communities = await Community.findAll({
            where: whereConditions,
            include: [
              { 
                model: Interest, 
                as: 'interests', 
                where: { id: { [Op.in]: userInterestIds } },
                required: false
              },
              { 
                model: User, 
                as: 'owner', 
                attributes: ['id', 'name', 'profileImageUrl'] 
              }
            ],
            attributes: [
              '*',
              // Calculate distance using Haversine formula
              [
                literal(`
                  6371 * acos(
                    cos(radians(${userLat})) * 
                    cos(radians(latitude)) * 
                    cos(radians(longitude) - radians(${userLng})) + 
                    sin(radians(${userLat})) * 
                    sin(radians(latitude))
                  )
                `),
                'distance'
              ]
            ],
            transaction
          });
    
          // Filter communities within max distance and compute relevance score
          const recommendations = communities
            .map(community => {
              const communityData = community.get({ plain: true });
              const distance = parseFloat(communityData.distance);
              
              // Skip if beyond max distance
              if (distance > maxDistance) return null;
    
              // Calculate matching interests
              const matchingInterests = community.interests.filter(i => userInterestIds.includes(i.id));
              if (!matchingInterests.length) return null;
    
              // Compute relevance score with location factor
              const locationScore = Math.max(0, (maxDistance - distance) / maxDistance * 20); // Max 20 points for location
              const interestScore = matchingInterests.length * 10;
              const popularityScore = community.memberCount / 100;
              const freeScore = !community.isPaid ? 5 : 0;
              
              const relevanceScore = locationScore + interestScore + popularityScore + freeScore;
    
              return {
                ...communityData,
                distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
                matchingInterests: matchingInterests.length,
                relevanceScore: Math.round(relevanceScore * 100) / 100
              };
            })
            .filter(Boolean)
            .sort((a, b) => {
              // Sort by relevance score first, then by distance, then by member count
              if (b.relevanceScore !== a.relevanceScore) {
                return b.relevanceScore - a.relevanceScore;
              }
              if (a.distance !== b.distance) {
                return a.distance - b.distance;
              }
              return b.memberCount - a.memberCount;
            })
            .slice(0, limit);
    
          return recommendations;
    
        } catch (error) {
          throw new GraphQLError('Failed to fetch location-based recommendations', {
            extensions: { code: 'LOCATION_RECOMMENDATIONS_FAILED', originalError: error.message }
          });
        }
      },
    
      /**
       * Get interest-based recommendations (fallback when no location data)
       */
      async getInterestBasedRecommendations({ userInterestIds, excludedIds, limit, transaction }) {
        try {
          // Find recommended communities based on interests only
          const communities = await Community.findAll({
            where: {
              id: excludedIds.length ? { [Op.notIn]: excludedIds } : { [Op.ne]: null },
              isPrivate: false
            },
            include: [
              { 
                model: Interest, 
                as: 'interests', 
                attributes: ['id', 'name', 'category'] 
              },
              { 
                model: User, 
                as: 'owner', 
                attributes: ['id', 'name', 'profileImageUrl'] 
              }
            ],
            transaction
          });
    
          // Compute relevance score and filter for at least one matching interest
          const recommendations = communities
            .map(community => {
              const matchingInterests = community.interests.filter(i => userInterestIds.includes(i.id));
              if (!matchingInterests.length) return null;
              
              // Compute relevance score (same as original logic)
              const relevanceScore = (matchingInterests.length * 10) + (community.memberCount / 100) + (!community.isPaid ? 5 : 0);
              
              return {
                ...community.get({ plain: true }),
                matchingInterests: matchingInterests.length,
                relevanceScore: Math.round(relevanceScore * 100) / 100
              };
            })
            .filter(Boolean)
            .sort((a, b) => b.relevanceScore - a.relevanceScore || b.memberCount - a.memberCount)
            .slice(0, limit);
    
          return recommendations;
    
        } catch (error) {
          throw new GraphQLError('Failed to fetch interest-based recommendations', {
            extensions: { code: 'INTEREST_RECOMMENDATIONS_FAILED', originalError: error.message }
          });
        }
      },
    
      /**
       * Get popular communities when user has no interests (optional fallback)
       */
      async getPopularCommunities({ excludedIds, limit, transaction }) {
        try {
          const communities = await Community.findAll({
            where: {
              id: excludedIds.length ? { [Op.notIn]: excludedIds } : { [Op.ne]: null },
              isPrivate: false
            },
            include: [
              { 
                model: Interest, 
                as: 'interests', 
              },
              { 
                model: User, 
                as: 'owner', 
              }
            ],
            order: [
              ['memberCount', 'DESC'],
              ['lastActivityAt', 'DESC']
            ],
            limit,
            transaction
          });
    
          return communities.map(community => ({
            ...community.get({ plain: true }),
            matchingInterests: 0,
            relevanceScore: community.memberCount / 100
          }));
    
        } catch (error) {
          throw new GraphQLError('Failed to fetch popular communities', {
            extensions: { code: 'POPULAR_COMMUNITIES_FAILED', originalError: error.message }
          });
        }
      },
    
    async registerForEvent(postId, userId) {
        try {
          const post = await CommunityPost.findById(postId);
          if (!post || post.type !== 'EVENT') {
            throw new Error('Event not found');
          }
    
          // Check if user is already registered
          const existingRegistration = await EventRegistration.findOne({
            userId,
            postId
          });
    
          if (existingRegistration) {
            throw new Error('User already registered for this event');
          }
    
          // Check if event has reached max capacity
          if (post.eventDetails.maxAttendees && 
              post.eventDetails.registrationCount >= post.eventDetails.maxAttendees) {
            throw new Error('Event has reached maximum capacity');
          }
    
          // Check registration deadline
          if (post.eventDetails.registrationDeadline && 
              new Date() > post.eventDetails.registrationDeadline) {
            throw new Error('Registration deadline has passed');
          }
    
          let paymentStatus = 'COMPLETED';
          let ticketCode = this.generateTicketCode();
    
          // Handle paid events
          if (post.eventDetails.ticketPrice && post.eventDetails.ticketPrice > 0) {
            // Process payment
            const paymentResult = await this.processEventPayment(
              userId, 
              post.eventDetails.ticketPrice, 
              post.eventDetails.currency
            );
            
            if (!paymentResult.success) {
              throw new Error('Payment failed');
            }
            
            paymentStatus = 'COMPLETED';
          }
    
          const registration = new EventRegistration({
            userId,
            postId,
            paymentStatus,
            ticketCode
          });
    
          await registration.save();
    
          // Update registration count
          await CommunityPost.findByIdAndUpdate(postId, {
            $inc: { 'eventDetails.registrationCount': 1 }
          });
    
          // Send confirmation notification
          await this.sendEventRegistrationConfirmation(userId, postId, ticketCode);
    
          return true;
        } catch (error) {
          console.error('Error registering for event:', error);
          throw error;
        }
    },

    // Helper methods
    generateSlug(name) {
        return name.toLowerCase()
          .replace(/[^a-z0-9 -]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim('-');
    },

    // Utility methods
  generateTicketCode() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  },

  async processPayment(userId, amount, currency) {
    // Integration with payment gateway (Stripe, PayPal, etc.)
    // This is a placeholder implementation
    try {
      // Payment processing logic here
      return { success: true, transactionId: 'txn_' + Date.now() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async processEventPayment(userId, amount, currency) {
    // Similar to processPayment but for events
    return this.processPayment(userId, amount, currency);
  },

  async notifyAdminsOfNewRequest(communityId, userId, transaction) {
    // Send notifications to community admins (including owner)
    const admins = await CommunityMember.findAll({
        where: {
            communityId,
            role: { [Op.in]: ['OWNER', 'ADMIN'] },
            status: 'APPROVED'
        },
        include: [{ model: User, as: 'user' }],
        transaction
    });
    // Get user info for the requester
    const requester = await User.findByPk(userId, { transaction });
    // Send email to each admin/owner
    for (const admin of admins) {
        const adminUser = admin.user;
        if (adminUser && adminUser.email) {
            try {
                await mailerService.sendEmail({
                    to: adminUser.email,
                    subject: `New join request for your community` ,
                    text: `User ${requester ? requester.name : userId} has requested to join your community. Please review and approve the request in your dashboard.` ,
                    html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                        <div style="background: #4f8cff; color: #fff; padding: 20px 24px;">
                          <h2 style="margin: 0; font-size: 1.5em;">New Join Request</h2>
                        </div>
                        <div style="padding: 24px; background: #fafbfc;">
                          <p style="font-size: 1.1em; margin-bottom: 16px;">
                            <b>${requester ? requester.name : userId}</b> has requested to join your community.
                          </p>
                          <p style="margin-bottom: 16px;">Please review and approve the request in your dashboard.</p>
                          <a href="https://your-app-url.com/community/${communityId}/admin" style="display: inline-block; background: #4f8cff; color: #fff; padding: 10px 18px; border-radius: 4px; text-decoration: none; font-weight: bold;">Review Requests</a>
                        </div>
                        <div style="background: #f1f3f6; color: #888; padding: 12px 24px; font-size: 0.95em;">
                          Xplore Pulse Team
                        </div>
                      </div>
                    `
                });
            } catch (mailErr) {
                // Log but do not fail the transaction if email fails
                logger.error('Failed to send join request email to admin:', { mailErr, adminEmail: adminUser.email });
            }
        }
    }
    // Also log for debugging
    logger.info('New member request notification sent to admins', { communityId, userId });
  },

  async notifyUserOfApproval(communityId, userId, transaction) {
    try {
        // Fetch user and community details
        const user = await User.findByPk(userId, { transaction });
        const community = await Community.findByPk(communityId, { transaction });
        if (!user || !community) return;

        // Compose email
        const subject = `Your request to join "${community.name}" has been approved!`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
            <div style="background: #4f8cff; color: #fff; padding: 20px 24px;">
              <h2 style="margin: 0; font-size: 1.5em;">Welcome to ${community.name}!</h2>
            </div>
            <div style="padding: 24px; background: #fafbfc;">
              <p style="font-size: 1.1em; margin-bottom: 16px;">
                Hi <b>${user.name || user.email}</b>,
              </p>
              <p style="margin-bottom: 16px;">Congratulations! Your request to join the community <b>${community.name}</b> has been <span style="color: #28a745; font-weight: bold;">approved</span>.</p>
              <a href="https://your-app-url.com/community/${community.slug}" style="display: inline-block; background: #4f8cff; color: #fff; padding: 10px 18px; border-radius: 4px; text-decoration: none; font-weight: bold;">Visit Community</a>
            </div>
            <div style="background: #f1f3f6; color: #888; padding: 12px 24px; font-size: 0.95em;">
              Xplore Pulse Team
            </div>
          </div>
        `;

        // Send email
        if(user.email){
            await mailerService.sendEmail({
                to: user.email,
                subject,
                text: `Hi ${user.name || user.email},\n\nCongratulations! Your request to join the community "${community.name}" has been approved. You can now participate in discussions, events, and more.\n\nVisit the community: https://your-app-url.com/community/${community.slug}\n\nBest regards,\nThe Xplore Pulse Team`,
                html
            });
        }
        logger.info('Approval notification sent to user', { userId, communityId });
    } catch (err) {
        // Log but do not throw
        logger.error('Failed to send approval notification email:', { err, userId, communityId });
    }
  },

  async sendEventRegistrationConfirmation(userId, postId, ticketCode) {
    // Send event registration confirmation
    console.log(`Event registration confirmed for user ${userId}, ticket: ${ticketCode}`);
  },

    async updateCommunity(communityId, input, userId) {
        const transaction = await sequelize.transaction();
        let uploadedImageUrl = null;
        let uploadedCoverImageUrl = null;
        let oldImageUrl = null;
        let oldCoverImageUrl = null;
        const uploadPromises = [];
        try {
            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Check if user is the owner
            if (community.ownerId !== userId) {
                throw new GraphQLError('Only the community owner can update the community', {
                    extensions: { code: 'UNAUTHORIZED_ACCESS' }
                });
            }

            // 4. Handle file uploads if present
            if (input.imageFile) {
                fileUploadService.validateImageFile(input.imageFile, 5);
                oldImageUrl = community.imageUrl;
                uploadPromises.push(
                    fileUploadService.uploadFile(input.imageFile, 'communities/profiles')
                        .then(url => { uploadedImageUrl = url; })
                );
            }
            if (input.coverImageFile) {
                fileUploadService.validateImageFile(input.coverImageFile, 10);
                oldCoverImageUrl = community.coverImageUrl;
                uploadPromises.push(
                    fileUploadService.uploadFile(input.coverImageFile, 'communities/covers')
                        .then(url => { uploadedCoverImageUrl = url; })
                );
            }
            if (uploadPromises.length > 0) {
                await Promise.all(uploadPromises);
            }

            // 5. Validate interests if provided
            if (input.interests && input.interests.length > 0) {
                const interestCount = await Interest.count({
                    where: { id: { [Op.in]: input.interests } },
                    transaction
                });
                if (interestCount !== input.interests.length) {
                    throw new GraphQLError('One or more interests not found', {
                        extensions: { code: 'INTEREST_NOT_FOUND' }
                    });
                }
            }

            // 6. Only allow updating allowed fields
            const updatableFields = [
                'name', 'description', 'isPrivate', 'isPaid', 'price', 'currency', 'location', 'settings'
            ];
            const updateData = {};
            for (const field of updatableFields) {
                if (input[field] !== undefined) {
                    if (field === 'name') {
                        updateData.name = input.name.trim();
                    } else if (field === 'description') {
                        updateData.description = input.description.trim();
                    } else if (field === 'location' && input.location) {
                        updateData.latitude = input.location.latitude
                        updateData.longitude = input.location.longitud
                    } else {
                        updateData[field] = input[field];
                    }
                }
            }
            // Add new image URLs if uploaded
            if (uploadedImageUrl) updateData.imageUrl = uploadedImageUrl;
            if (uploadedCoverImageUrl) updateData.coverImageUrl = uploadedCoverImageUrl;

            // 7. Update the community
            await community.update(updateData, { transaction });

            // 8. Update interests association if provided
            if (input.interests && input.interests.length > 0) {
                const interests = await Interest.findAll({
                    where: { id: { [Op.in]: input.interests } },
                    transaction
                });
                await community.setInterests(interests, { transaction });
            }

            // 9. Delete old images if replaced
            if (uploadedImageUrl && oldImageUrl) {
                try { await fileUploadService.deleteFile(oldImageUrl); } catch (e) { }
            }
            if (uploadedCoverImageUrl && oldCoverImageUrl) {
                try { await fileUploadService.deleteFile(oldCoverImageUrl); } catch (e) { }
            }

            // 10. Fetch the updated community with all relations
            const updatedCommunity = await Community.findByPk(communityId, {
                include: [
                    { model: User, as: 'owner' },
                    { model: Interest, as: 'interests' },
                    { model: User, as: 'admins', through: { where: { role: 'ADMIN', status: 'APPROVED' } } },
                    { model: User, as: 'moderators', through: { where: { role: 'MODERATOR', status: 'APPROVED' } } }
                ],
                transaction
            });

            updatedCommunity.isOwner = updatedCommunity.ownerId === userId
            updatedCommunity.isAdmin = await this.isAdmin(updatedCommunity.id, userId, transaction)
            updatedCommunity.isModerator = await this.isModerator(updatedCommunity.id, userId, transaction)
            updatedCommunity.canCreateEvents = await this.canCreateEvents(updatedCommunity.id, userId, transaction)
            updatedCommunity.canPost = await this.canPost(updatedCommunity.id, userId, transaction)
            updatedCommunity.membershipStatus = await this.getMembershipStatus(updatedCommunity.id, userId, transaction)

            await transaction.commit()
            return updatedCommunity;
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            // Clean up new uploads if transaction fails
            try {
                if (uploadedImageUrl) await fileUploadService.deleteFile(uploadedImageUrl);
                if (uploadedCoverImageUrl) await fileUploadService.deleteFile(uploadedCoverImageUrl);
            } catch (cleanupError) { }
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to update community', {
                extensions: { code: 'COMMUNITY_UPDATE_FAILED', originalError: error.message }
            });
        }
    },

    async deleteCommunity(communityId, userId) {
        const transaction = await sequelize.transaction();
        let imageUrl = null;
        let coverImageUrl = null;
        try {
            logger.info('Starting community deletion', { communityId, userId });
            // 1. Check that the community exists
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found during deletion', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 2. Check that the user is the owner
            if (community.ownerId !== userId) {
                logger.warn('Unauthorized community delete attempt', { communityId, userId });
                throw new GraphQLError('Only the community owner can delete the community', {
                    extensions: { code: 'UNAUTHORIZED_ACCESS' }
                });
            }

            // 3. Store image URLs for cleanup
            imageUrl = community.imageUrl;
            coverImageUrl = community.coverImageUrl;

            // 4. Delete related records (cascading)
            try {
                await CommunityMember.destroy({ where: { communityId }, transaction });
                await CommunityPost.destroy({ where: { communityId }, transaction });
                await CommunityInterest.destroy({ where: { communityId }, transaction });
            } catch (relatedError) {
                logger.error('Failed to delete related community records', { relatedError, communityId });
                throw relatedError;
            }

            // 5. Remove the community itself
            try {
                await community.destroy({ transaction });
            } catch (destroyError) {
                logger.error('Failed to destroy community record', { destroyError, communityId });
                throw destroyError;
            }

            // 6. Commit transaction
            await transaction.commit();
            logger.info('Community deleted successfully', { communityId });

            // 7. Attempt to clean up images (not transactional)
            if (imageUrl) {
                try {
                    await fileUploadService.deleteFile(imageUrl);
                    logger.info('Deleted community profile image after deletion', { imageUrl });
                } catch (imgErr) {
                    logger.error('Failed to delete community profile image after deletion', { imgErr, imageUrl });
                }
            }
            if (coverImageUrl) {
                try {
                    await fileUploadService.deleteFile(coverImageUrl);
                    logger.info('Deleted community cover image after deletion', { coverImageUrl });
                } catch (coverErr) {
                    logger.error('Failed to delete community cover image after deletion', { coverErr, coverImageUrl });
                }
            }

            return {
                success: true,
                message: "Community deleted successfully"
            };
        } catch (error) {
            logger.error('Error during community deletion', { error, communityId, userId });
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('Community deletion transaction rolled back', { communityId, userId });
            }
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Community cannot be deleted due to related records.', {
                    extensions: { code: 'DELETE_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to delete community', {
                extensions: { code: 'COMMUNITY_DELETE_FAILED', originalError: error.message }
            });
        }
    },

    async leaveCommunity(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('User attempting to leave community', { communityId, userId });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in leaveCommunity', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in leaveCommunity', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('User is not a member in leaveCommunity', { communityId, userId });
                throw new GraphQLError('You are not a member of this community', {
                    extensions: { code: 'NOT_A_MEMBER' }
                });
            }

            // 4. Prevent owner from leaving
            if (membership.role === 'OWNER') {
                logger.warn('Owner attempted to leave community', { communityId, userId });
                throw new GraphQLError('Community owner cannot leave the community', {
                    extensions: { code: 'OWNER_CANNOT_LEAVE' }
                });
            }

            // 5. Remove the membership
            try {
                await membership.destroy({ transaction });
            } catch (destroyErr) {
                logger.error('Failed to destroy membership in leaveCommunity', { destroyErr, communityId, userId });
                throw destroyErr;
            }

            // 6. Decrement member count if previously approved
            if (membership.status === 'APPROVED') {
                try {
                    await Community.decrement('memberCount', {
                        by: 1,
                        where: { id: communityId },
                        transaction
                    });
                } catch (decrementErr) {
                    logger.error('Failed to decrement member count in leaveCommunity', { decrementErr, communityId });
                    throw decrementErr;
                }
            }

            // 7. Notify admins/owner
            try {
                await this.notifyAdminsOfLeave(communityId, userId, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify admins of leave in leaveCommunity', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('User left community successfully', { communityId, userId });
            return {
                success: true,
                message: 'You have left the community successfully.'
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('leaveCommunity transaction rolled back', { communityId, userId });
            }
            logger.error('Error in leaveCommunity', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('You cannot leave this community due to related records.', {
                    extensions: { code: 'LEAVE_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to leave community', {
                extensions: { code: 'LEAVE_COMMUNITY_FAILED', originalError: error.message }
            });
        }
    },

    async notifyAdminsOfLeave(communityId, userId, transaction) {
        // Send notifications to community admins (including owner) when a member leaves
        try {
            const admins = await CommunityMember.findAll({
                where: {
                    communityId,
                    role: { [Op.in]: ['OWNER', 'ADMIN'] },
                    status: 'APPROVED'
                },
                include: [{ model: User, as: 'user' }],
                transaction
            });
            // Get user info for the leaver
            const leaver = await User.findByPk(userId, { transaction });
            // Send email to each admin/owner
            for (const admin of admins) {
                const adminUser = admin.user;
                if (adminUser && adminUser.email) {
                    try {
                        await mailerService.sendEmail({
                            to: adminUser.email,
                            subject: `A member has left your community`,
                            text: `User ${leaver ? leaver.name : userId} has left your community.`,
                            html: `
                              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                                <div style="background: #ff4f4f; color: #fff; padding: 20px 24px;">
                                  <h2 style="margin: 0; font-size: 1.5em;">Member Left</h2>
                                </div>
                                <div style="padding: 24px; background: #fafbfc;">
                                  <p style="font-size: 1.1em; margin-bottom: 16px;">
                                    <b>${leaver ? leaver.name : userId}</b> has left your community.
                                  </p>
                                </div>
                                <div style="background: #f1f3f6; color: #888; padding: 12px 24px; font-size: 0.95em;">
                                  Xplore Pulse Team
                                </div>
                              </div>
                            `
                        });
                    } catch (mailErr) {
                        logger.error('Failed to send leave notification email to admin:', { mailErr, adminEmail: adminUser.email });
                    }
                }
            }
            logger.info('Leave notification sent to admins', { communityId, userId });
        } catch (err) {
            logger.error('Failed to notify admins of leave', { err, communityId, userId });
        }
    },

    async getPendingMemberRequests({ communityId, limit = 20, cursor }) {
        let transaction;
        try {
            // 1. Validate input
            if (!communityId ) {
                throw new GraphQLError('Missing or invalid communityId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'communityId' }
                });
            }
            if (typeof limit !== 'number' || isNaN(limit) || limit < 1 || limit > 100) {
                throw new GraphQLError('Limit must be a number between 1 and 100', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' }
                });
            }

            // 2. Start transaction
            transaction = await sequelize.transaction();

            // 3. Check if community exists
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND', field: 'communityId' }
                });
            }

            // 4. Build query for pending members
            let query = {
                where: {
                    communityId,
                    status: 'PENDING'
                },
                order: [['requestedAt', 'DESC']],
                limit: limit + 1,
                include: [{ model: User, as: 'user' }],
                transaction
            };
            if (cursor) {
                let decodedCursor;
                try {
                    decodedCursor = Buffer.from(cursor, 'base64').toString('ascii');
                    if (!decodedCursor || typeof decodedCursor !== 'string') {
                        throw new Error('Decoded cursor is not a string');
                    }
                } catch (err) {
                    throw new GraphQLError('Invalid cursor value', {
                        extensions: { code: 'INVALID_CURSOR', field: 'cursor' }
                    });
                }
                query.where.id = { [Op.lt]: decodedCursor };
            }

            // 5. Fetch members
            const members = await CommunityMember.findAll(query);
            const hasNextPage = members.length > limit;
            const edges = members.slice(0, limit).map(member => ({
                node: member,
                cursor: Buffer.from(member.id).toString('base64')
            }));

            // 6. Count total pending
            const totalCount = await CommunityMember.count({
                where: { communityId, status: 'PENDING' },
                transaction
            });

            await transaction.commit();
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage && edges.length > 0 ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            // Log error with context
            logger.error('getPendingMemberRequests error', { error, communityId, limit, cursor });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch pending member requests', {
                extensions: { code: 'PENDING_MEMBER_REQUESTS_FAILED', originalError: error.message }
            });
        }
    },

    async rejectMemberRequest(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Rejecting member request', { communityId, userId });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in rejectMemberRequest', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in rejectMemberRequest', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership request not found in rejectMemberRequest', { communityId, userId });
                throw new GraphQLError('Membership request not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Check if already rejected, banned, or not pending
            if (membership.status === 'REJECTED') {
                logger.warn('Membership already rejected in rejectMemberRequest', { communityId, userId });
                throw new GraphQLError('Membership request is already rejected', {
                    extensions: { code: 'ALREADY_REJECTED' }
                });
            }
            if (membership.status === 'BANNED') {
                logger.warn('Attempt to reject banned member in rejectMemberRequest', { communityId, userId });
                throw new GraphQLError('User is banned from this community and cannot be rejected.', {
                    extensions: { code: 'BANNED' }
                });
            }
            if (membership.status === 'APPROVED') {
                logger.warn('Attempt to reject already approved member in rejectMemberRequest', { communityId, userId });
                throw new GraphQLError('User is already a member of the community', {
                    extensions: { code: 'ALREADY_MEMBER' }
                });
            }
            if (membership.status !== 'PENDING') {
                logger.warn('Membership request is not pending in rejectMemberRequest', { communityId, userId, status: membership.status });
                throw new GraphQLError('Membership request is not pending', {
                    extensions: { code: 'NOT_PENDING' }
                });
            }

            // 5. Reject the membership
            try {
                membership.status = 'REJECTED';
                await membership.save({ transaction });
            } catch (saveErr) {
                logger.error('Failed to save rejected membership in rejectMemberRequest', { saveErr, communityId, userId });
                throw saveErr;
            }

            // 6. Notify user of rejection
            try {
                await this.notifyUserOfRejection(communityId, userId, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of rejection in rejectMemberRequest', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('Membership request rejected successfully', { communityId, userId });
            return {
                success: true,
                message: 'Membership request rejected successfully.'
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('rejectMemberRequest transaction rolled back', { communityId, userId });
            }
            logger.error('Error in rejectMemberRequest', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not reject member due to related records.', {
                    extensions: { code: 'REJECT_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to reject member request', {
                extensions: { code: 'REJECT_MEMBER_FAILED', originalError: error.message }
            });
        }
    },

    async notifyUserOfRejection(communityId, userId, transaction) {
        try {
            // Fetch user and community details
            const user = await User.findByPk(userId, { transaction });
            const community = await Community.findByPk(communityId, { transaction });
            if (!user || !community) return;

            // Compose email
            const subject = `Your request to join "${community.name}" has been rejected`;
            const message = `Hi ${user.name || user.email},\n\nWe regret to inform you that your request to join the community "${community.name}" has been rejected. You may try joining other communities or contact the community owner for more information.\n\nBest regards,\nThe Xplore Pulse Team`;
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Community Request Rejected</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* ...styles as above... */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cdn-icons-png.flaticon.com/512/463/463612.png" alt="Rejected" />
      <h1>Request Rejected</h1>
    </div>
    <p>Hi <strong>${user.name || user.email}</strong>,</p>
    <p>
      We regret to inform you that your request to join the community
      <span class="community-name">${community.name}</span>
      has been <span style="color:#e53e3e;font-weight:bold;">rejected</span>.
    </p>
    <p>
      You may try joining other communities or contact the community owner for more information.
    </p>
    <a href="https://xplorepulse.com/communities" class="button">Explore Other Communities</a>
    <div class="footer">
      &copy; 2024 Xplore Pulse. All rights reserved.
    </div>
  </div>
</body>
</html>`;

            // Send email
            if(user.email){
                await mailerService.sendEmail({
                    to: user.email,
                    subject,
                    text: message,
                    html
                });
            }
        } catch (err) {
            // Log but do not throw
            console.error('Failed to send rejection notification email:', err);
        }
    },

    async assignMemberRole(communityId, userId, role) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Assigning member role', { communityId, userId, role });
            // 1. Validate input
            if (!communityId || !userId || !role) {
                logger.warn('Missing communityId, userId, or role in assignMemberRole', { communityId, userId, role });
                throw new GraphQLError('Missing communityId, userId, or role', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }
            if (!['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'].includes(role)) {
                logger.warn('Invalid role in assignMemberRole', { role });
                throw new GraphQLError('Invalid role', {
                    extensions: { code: 'INVALID_ROLE' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in assignMemberRole', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership not found in assignMemberRole', { communityId, userId });
                throw new GraphQLError('Membership not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Only allow role assignment for APPROVED members
            if (membership.status !== 'APPROVED') {
                logger.warn('Attempt to assign role to non-approved member in assignMemberRole', { communityId, userId, status: membership.status });
                throw new GraphQLError('Only approved members can be assigned roles', {
                    extensions: { code: 'MEMBER_NOT_APPROVED' }
                });
            }

            // 4.5. Prevent assigning the same role
            if (membership.role === role) {
                logger.warn('Attempt to assign already assigned role in assignMemberRole', { communityId, userId, role });
                throw new GraphQLError(`User is already assigned the role ${role}`, {
                    extensions: { code: 'ALREADY_ASSIGNED_ROLE' }
                });
            }

            // 5. Prevent assigning OWNER role to anyone but the current owner
            if (role === 'OWNER' && community.ownerId !== userId) {
                logger.warn('Attempt to assign OWNER role to non-owner in assignMemberRole', { communityId, userId });
                throw new GraphQLError('Only the current owner can be assigned the OWNER role', {
                    extensions: { code: 'OWNER_ASSIGNMENT_NOT_ALLOWED' }
                });
            }

            // 6. Prevent demoting the only OWNER
            if (membership.role === 'OWNER' && role !== 'OWNER') {
                const otherOwners = await CommunityMember.count({
                    where: {
                        communityId,
                        role: 'OWNER',
                        userId: { [Op.ne]: userId },
                        status: 'APPROVED'
                    },
                    transaction
                });
                if (otherOwners === 0) {
                    logger.warn('Attempt to demote the only owner in assignMemberRole', { communityId, userId });
                    throw new GraphQLError('Cannot demote the only owner of the community', {
                        extensions: { code: 'CANNOT_DEMOTE_ONLY_OWNER' }
                    });
                }
            }

            // 7. Prevent assigning roles to banned or rejected members
            if (membership.status === 'BANNED') {
                logger.warn('Attempt to assign role to banned member in assignMemberRole', { communityId, userId });
                throw new GraphQLError('Cannot assign roles to banned members', {
                    extensions: { code: 'BANNED' }
                });
            }
            if (membership.status === 'REJECTED') {
                logger.warn('Attempt to assign role to rejected member in assignMemberRole', { communityId, userId });
                throw new GraphQLError('Cannot assign roles to rejected members', {
                    extensions: { code: 'REJECTED' }
                });
            }

            // 8. Update the role
            try {
                membership.role = role;
                await membership.save({ transaction });
            } catch (saveErr) {
                logger.error('Failed to save new role in assignMemberRole', { saveErr, communityId, userId, role });
                throw saveErr;
            }

            // 9. Notify the user of their new role
            try {
                await this.notifyUserOfRoleChange(communityId, userId, role, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of role change in assignMemberRole', { notifyErr, communityId, userId, role });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('Role updated successfully in assignMemberRole', { communityId, userId, role });
            return {
                success: true,
                message: `Role updated to ${role} successfully.`
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('assignMemberRole transaction rolled back', { communityId, userId, role });
            }
            logger.error('Error in assignMemberRole', { error, communityId, userId, role });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not assign role due to related records.', {
                    extensions: { code: 'ASSIGN_ROLE_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to assign member role', {
                extensions: { code: 'ASSIGN_ROLE_FAILED', originalError: error.message }
            });
        }
    },

    async notifyUserOfRoleChange(communityId, userId, role, transaction) {
        try {
            // Fetch user and community details
            const user = await User.findByPk(userId, { transaction });
            const community = await Community.findByPk(communityId, { transaction });
            if (!user || !community) return;

            // Compose email
            const subject = `Your role in "${community.name}" has been updated to ${role}`;
            const message = `Hi ${user.name || user.email},\n\nYour role in the community "${community.name}" has been updated to ${role}.\n\nBest regards,\nThe Xplore Pulse Team`;
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Role Updated in Community</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* ...styles as above... */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cdn-icons-png.flaticon.com/512/3135/3135715.png" alt="Role Update" />
      <h1>Role Updated!</h1>
    </div>
    <p>Hi <strong>${user.name || user.email}</strong>,</p>
    <p>
      Your role in the community
      <span class="community-name">${community.name}</span>
      has been updated to
      <span class="role-badge">${role}</span>.
    </p>
    <p>
      You now have new permissions and responsibilities in this community. If you have any questions, feel free to contact the community admin.
    </p>
    <div class="footer">
      &copy; 2024 Xplore Pulse. All rights reserved.
    </div>
  </div>
</body>
</html>`;

            if(user.email){
                // Send email
            await mailerService.sendEmail({
                to: user.email,
                subject,
                text: message,
                html
            });
            }
        } catch (err) {
            // Log but do not throw
            console.error('Failed to send role change notification email:', err);
        }
    },

    async removeMemberRole(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Removing member role', { communityId, userId });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in removeMemberRole', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in removeMemberRole', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership not found in removeMemberRole', { communityId, userId });
                throw new GraphQLError('Membership not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Only allow removal for APPROVED members
            if (membership.status !== 'APPROVED') {
                logger.warn('Member not approved in removeMemberRole', { communityId, userId, status: membership.status });
                if (membership.status === 'BANNED') {
                    throw new GraphQLError('Cannot remove role from a banned member', {
                        extensions: { code: 'MEMBER_BANNED' }
                    });
                }
                if (membership.status === 'REJECTED') {
                    throw new GraphQLError('Cannot remove role from a rejected member', {
                        extensions: { code: 'MEMBER_REJECTED' }
                    });
                }
                throw new GraphQLError('Only approved members can have roles removed', {
                    extensions: { code: 'MEMBER_NOT_APPROVED' }
                });
            }

            // 5. Prevent removing OWNER role from the only owner
            if (membership.role === 'OWNER') {
                const otherOwners = await CommunityMember.count({
                    where: {
                        communityId,
                        role: 'OWNER',
                        userId: { [Op.ne]: userId },
                        status: 'APPROVED'
                    },
                    transaction
                });
                if (otherOwners === 0) {
                    logger.warn('Attempt to remove only owner in removeMemberRole', { communityId, userId });
                    throw new GraphQLError('Cannot remove OWNER role from the only owner of the community', {
                        extensions: { code: 'CANNOT_REMOVE_ONLY_OWNER' }
                    });
                }
            }

            // 6. If already MEMBER, throw error
            if (membership.role === 'MEMBER') {
                logger.warn('User is already a MEMBER in removeMemberRole', { communityId, userId });
                throw new GraphQLError('User is already a MEMBER and cannot have the MEMBER role removed', {
                    extensions: { code: 'ALREADY_MEMBER_ROLE' }
                });
            }

            // 7. Set the role to MEMBER
            membership.role = 'MEMBER';
            await membership.save({ transaction });

            // 8. Notify the user of their role removal
            try {
                await this.notifyUserOfRoleRemoval(communityId, userId, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of role removal in removeMemberRole', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('Role removed successfully in removeMemberRole', { communityId, userId });
            return {
                success: true,
                message: `Role removed successfully. User is now a MEMBER.`
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('removeMemberRole transaction rolled back', { communityId, userId });
            }
            logger.error('Error in removeMemberRole', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not remove role due to related records.', {
                    extensions: { code: 'REMOVE_ROLE_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to remove member role', {
                extensions: { code: 'REMOVE_ROLE_FAILED', originalError: error.message }
            });
        }
    },

    async notifyUserOfRoleRemoval(communityId, userId, transaction) {
        try {
            // Fetch user and community details
            const user = await User.findByPk(userId, { transaction });
            const community = await Community.findByPk(communityId, { transaction });
            if (!user || !community) return;

            // Compose email
            const subject = `Your role in "${community.name}" has been removed`;
            const message = `Hi ${user.name || user.email},\n\nYour special role in the community "${community.name}" has been removed. You are now a regular MEMBER.\n\nBest regards,\nThe Xplore Pulse Team`;
            const html = `<p>Hi ${user.name || user.email},</p>\n<p>Your special role in the community <b>${community.name}</b> has been removed. You are now a regular <b>MEMBER</b>.</p>\n<p>Best regards,<br/>The Xplore Pulse Team</p>`;

            // Send email
            
        } catch (err) {
            // Log but do not throw
            console.error('Failed to send role removal notification email:', err);
        }
    },

    async banMember(communityId, userId, reason) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Banning member', { communityId, userId, reason });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in banMember', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }
            if (typeof reason !== 'string' || reason.trim().length === 0) {
                logger.warn('Missing or invalid reason in banMember', { communityId, userId, reason });
                throw new GraphQLError('Ban reason is required', {
                    extensions: { code: 'BAN_REASON_REQUIRED' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in banMember', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership not found in banMember', { communityId, userId });
                throw new GraphQLError('Membership not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Prevent banning the owner
            if (membership.role === 'OWNER') {
                logger.warn('Attempt to ban owner in banMember', { communityId, userId });
                throw new GraphQLError('Cannot ban the owner of the community', {
                    extensions: { code: 'CANNOT_BAN_OWNER' }
                });
            }

            // 6. Handle already banned/rejected
            if (membership.status === 'BANNED') {
                logger.warn('User already banned in banMember', { communityId, userId });
                throw new GraphQLError('User is already banned from this community', {
                    extensions: { code: 'ALREADY_BANNED' }
                });
            }
            if (membership.status === 'REJECTED') {
                logger.warn('User is rejected in banMember', { communityId, userId });
                throw new GraphQLError('Cannot ban a rejected member', {
                    extensions: { code: 'ALREADY_REJECTED' }
                });
            }

            // 7. Set status to BANNED and save reason
            membership.status = 'BANNED';
            membership.banReason = reason;
            membership.bannedBy = communityId
            membership.bannedAt = new Date()
            await membership.save({ transaction });

            // 8. Notify the user of their ban (optional, wrap in try/catch)
            try {
                await this.notifyUserOfBan(communityId, userId, reason, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of ban in banMember', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('User banned successfully in banMember', { communityId, userId });
            return {
                success: true,
                message: 'User has been banned from the community.'
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('banMember transaction rolled back', { communityId, userId });
            }
            logger.error('Error in banMember', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not ban member due to related records.', {
                    extensions: { code: 'BAN_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to ban member', {
                extensions: { code: 'BAN_MEMBER_FAILED', originalError: error.message }
            });
        }
    },

    async notifyUserOfBan(communityId, userId, reason, transaction) {
        try {
            // Fetch user and community details
            const user = await User.findByPk(userId, { transaction });
            const community = await Community.findByPk(communityId, { transaction });
            if (!user || !community) return;

            // Compose email
            const subject = `You have been banned from "${community.name}"`;
            const message = `Hi ${user.name || user.email},\n\nYou have been banned from the community "${community.name}".${reason ? `\n\nReason: ${reason}` : ''}\n\nIf you believe this was a mistake, please contact the community owner.\n\nBest regards,\nThe Xplore Pulse Team`;
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Banned from Community</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* ...styles as above... */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cdn-icons-png.flaticon.com/512/463/463612.png" alt="Banned" />
      <h1>Access Revoked</h1>
    </div>
    <p>Hi <strong>${user.name || user.email}</strong>,</p>
    <p>
      We regret to inform you that you have been <span style="color:#e53e3e;font-weight:bold;">banned</span> from the community
      <span class="community-name">${community.name}</span>.
    </p>
    <div class="ban-reason">
      <strong>Reason:</strong> ${banReason}
    </div>
    <p>
      If you believe this was a mistake or have questions, please contact the community admin.
    </p>
    <a href="https://xplorepulse.com/support" class="button">Contact Support</a>
    <div class="footer">
      &copy; 2024 Xplore Pulse. All rights reserved.
    </div>
  </div>
</body>
</html>`;

            // Send email
            if(user.email){
                await mailerService.sendEmail({
                    to: user.email,
                    subject,
                    text: message,
                    html
                });
            }
        } catch (err) {
            // Log but do not throw
            console.error('Failed to send ban notification email:', err);
        }
    },

    async unbanMember(communityId, userId) {
        const transaction = await sequelize.transaction();
        try {
            logger.info('Unbanning member', { communityId, userId });
            // 1. Validate input
            if (!communityId || !userId) {
                logger.warn('Missing communityId or userId in unbanMember', { communityId, userId });
                throw new GraphQLError('Missing communityId or userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT' }
                });
            }

            // 2. Find the community
            const community = await Community.findByPk(communityId, { transaction });
            if (!community) {
                logger.warn('Community not found in unbanMember', { communityId });
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND' }
                });
            }

            // 3. Find the membership
            const membership = await CommunityMember.findOne({
                where: { communityId, userId },
                transaction
            });
            if (!membership) {
                logger.warn('Membership not found in unbanMember', { communityId, userId });
                throw new GraphQLError('Membership not found', {
                    extensions: { code: 'MEMBERSHIP_NOT_FOUND' }
                });
            }

            // 4. Only allow unbanning for BANNED members
            if (membership.status !== 'BANNED') {
                logger.warn('User is not currently banned in unbanMember', { communityId, userId, status: membership.status });
                if (membership.status === 'REJECTED') {
                    throw new GraphQLError('User is already rejected and not banned', {
                        extensions: { code: 'ALREADY_REJECTED' }
                    });
                }
                if (membership.status === 'APPROVED') {
                    throw new GraphQLError('User is already an approved member and not banned', {
                        extensions: { code: 'ALREADY_APPROVED' }
                    });
                }
                throw new GraphQLError('User is not currently banned', {
                    extensions: { code: 'NOT_BANNED' }
                });
            }

            // 5. Prevent unbanning the owner (should not be possible, but for safety)
            if (membership.role === 'OWNER') {
                logger.warn('Attempt to unban owner in unbanMember', { communityId, userId });
                throw new GraphQLError('Cannot unban the owner of the community', {
                    extensions: { code: 'CANNOT_UNBAN_OWNER' }
                });
            }

            // 6. Set status to REJECTED, clear banReason and bannedAt, set role to MEMBER
            membership.status = 'REJECTED';
            membership.banReason = null;
            membership.bannedAt = null;
            membership.bannedBy = null
            membership.role = 'MEMBER';
            await membership.save({ transaction });

            // 7. Notify the user of their unban
            try {
                await this.notifyUserOfUnban(communityId, userId, transaction);
            } catch (notifyErr) {
                logger.error('Failed to notify user of unban in unbanMember', { notifyErr, communityId, userId });
                // Do not throw, just log
            }

            await transaction.commit();
            logger.info('User unbanned successfully in unbanMember', { communityId, userId });
            return {
                success: true,
                message: 'User has been unbanned from the community.'
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
                logger.warn('unbanMember transaction rolled back', { communityId, userId });
            }
            logger.error('Error in unbanMember', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            if (error.name === 'SequelizeUniqueConstraintError') {
                throw new GraphQLError('Could not unban member due to related records.', {
                    extensions: { code: 'UNBAN_CONSTRAINT' }
                });
            }
            if (error.name === 'SequelizeValidationError') {
                throw new GraphQLError(`Validation error: ${error.message}`, {
                    extensions: { code: 'VALIDATION_ERROR' }
                });
            }
            throw new GraphQLError('Failed to unban member', {
                extensions: { code: 'UNBAN_MEMBER_FAILED', originalError: error.message }
            });
        }
    },

    async notifyUserOfUnban(communityId, userId, transaction) {
        try {
            // Fetch user and community details
            const user = await User.findByPk(userId, { transaction });
            const community = await Community.findByPk(communityId, { transaction });
            if (!user || !community) return;

            // Compose email
            const subject = `You have been unbanned from "${community.name}"`;
            const message = `Hi ${user.name || user.email},\n\nYou have been unbanned from the community "${community.name}". You may now request to join again.\n\nBest regards,\nThe Xplore Pulse Team`;
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Unbanned from Community</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* ...styles as above... */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://cdn-icons-png.flaticon.com/512/190/190411.png" alt="Unbanned" />
      <h1>Welcome Back!</h1>
    </div>
    <p>Hi <strong>${user.name || user.email}</strong>,</p>
    <p>
      Good news! You have been <span style="color:#38a169;font-weight:bold;">unbanned</span> from the community
      <span class="community-name">${community.name}</span>.
    </p>
    <p>
      You can now participate and engage with the community again. Please make sure to follow the community guidelines to ensure a positive experience for everyone.
    </p>
    <a href="https://xplorepulse.com/community/${community.id}" class="button">Visit Community</a>
    <div class="footer">
      &copy; 2024 Xplore Pulse. All rights reserved.
    </div>
  </div>
</body>
</html>`;

           if(user.email){
             // Send email
             await mailerService.sendEmail({
                to: user.email,
                subject,
                text: message,
                html
            });
           }
        } catch (err) {
            // Log but do not throw
            console.error('Failed to send unban notification email:', err);
        }
    },

    async getUserJoinedCommunities({ userId, limit = 20, cursor, status }) {
        let transaction;
        try {
            logger.info('Fetching user joined communities', { userId, limit, status });
            
            // 1. Validate input
            if (!userId || typeof userId !== 'string') {
                throw new GraphQLError('Missing or invalid userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'userId' }
                });
            }
            this.validateUUID(userId, 'userId');
      
            if (typeof limit !== 'number' || isNaN(limit) || limit < 1 || limit > 100) {
                throw new GraphQLError('Limit must be a number between 1 and 100', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' }
                });
            }
      
            const allowedStatuses = ['APPROVED', 'PENDING', 'REJECTED', 'BANNED'];
            if (!status) status = 'APPROVED';
            if (!allowedStatuses.includes(status)) {
                throw new GraphQLError('Invalid status value', {
                    extensions: { code: 'INVALID_STATUS', field: 'status' }
                });
            }
      
            // 2. Start transaction
            transaction = await sequelize.transaction();
            
            // 3. Validate user exists
            const user = await User.findByPk(userId, { attributes: ['id'], transaction });
            if (!user) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'USER_NOT_FOUND', field: 'userId' }
                });
            }
      
            // 4. Build pagination filter
            const where = { userId, status };
            if (cursor) {
                let decodedCursor;
                try {
                    decodedCursor = new Date(Buffer.from(cursor, 'base64').toString('ascii'));
                    if (isNaN(decodedCursor)) throw new Error();
                } catch {
                    throw new GraphQLError('Invalid cursor value', {
                        extensions: { code: 'INVALID_CURSOR', field: 'cursor' }
                    });
                }
                where.joinedAt = { [Op.lt]: decodedCursor };
            }
      
            // 5. Fetch community memberships with optimized includes
            const memberships = await CommunityMember.findAll({
                where,
                order: [['joinedAt', 'DESC']],
                limit: limit + 1, // fetch extra for pagination
                include: [{
                    model: Community,
                    as: 'community',
                    attributes: ['id', 'name', 'profileImageUrl', 'slug', 'memberCount', 'isPrivate'],
                    include: [
                        { 
                            model: User, 
                            as: 'owner', 
                            attributes: ['id', 'name', 'profileImageUrl'],
                            required: false
                        },
                        { 
                            model: Interest, 
                            as: 'interests', 
                            attributes: ['id', 'name', 'category'],
                            required: false
                        }
                    ]
                }],
                raw: false, // required to maintain nested model instances
                transaction
            });
      
            const hasNextPage = memberships.length > limit;
            const sliced = memberships.slice(0, limit);
      
            const edges = sliced.map(membership => ({
                node: membership.community,
                cursor: Buffer.from(membership.joinedAt.toISOString()).toString('base64')
            }));
      
            // 6. Total joined count
            const totalCount = await CommunityMember.count({
                where: { userId, status },
                transaction
            });
      
            await transaction.commit();
            logger.info('Successfully fetched user joined communities', { userId, count: edges.length, status });
            
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('getUserJoinedCommunities error', { error, userId, limit, cursor, status });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch joined communities', {
                extensions: { code: 'MY_JOINED_COMMUNITIES_FAILED', originalError: error.message }
            });
        }
    },

    async getUserOwnedCommunities({ userId, limit = 20, cursor }) {
        let transaction;
        try {
            logger.info('Fetching user owned communities', { userId, limit });
            
            // 1. Validate input
            if (!userId || typeof userId !== 'string') {
                throw new GraphQLError('Missing or invalid userId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'userId' }
                });
            }
            this.validateUUID(userId, 'userId');
            
            if (typeof limit !== 'number' || isNaN(limit) || limit < 1 || limit > 100) {
                throw new GraphQLError('Limit must be a number between 1 and 100', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'limit' }
                });
            }
      
            // 2. Start transaction
            transaction = await sequelize.transaction();
            
            // 3. Validate user exists
            const user = await User.findByPk(userId, { attributes: ['id'], transaction });
            if (!user) {
                throw new GraphQLError('User not found', {
                    extensions: { code: 'USER_NOT_FOUND', field: 'userId' }
                });
            }
            
            // 4. Decode cursor if present (createdAt ISO string)
            let cursorDate;
            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
                    cursorDate = new Date(decoded);
                    if (isNaN(cursorDate.getTime())) {
                        throw new Error('Invalid date');
                    }
                } catch {
                    throw new GraphQLError('Invalid cursor value', {
                        extensions: { code: 'INVALID_CURSOR', field: 'cursor' }
                    });
                }
            }
      
            // 5. Build query
            const where = {
                ownerId: userId,
                ...(cursorDate ? { createdAt: { [Op.lt]: cursorDate } } : {})
            };
      
            const communities = await Community.findAll({
                where,
                order: [['createdAt', 'DESC']],
                limit: limit + 1, // fetch one extra to check next page
                include: [
                    { 
                        model: User, 
                        as: 'owner', 
                        attributes: ['id', 'name', 'profileImageUrl'],
                        required: false
                    },
                    { 
                        model: Interest, 
                        as: 'interests', 
                        attributes: ['id', 'name', 'category'],
                        required: false
                    }
                ],
                transaction
            });
      
            // 6. Pagination logic
            const hasNextPage = communities.length > limit;
            const sliced = communities.slice(0, limit);
      
            const edges = sliced.map(c => ({
                node: c,
                cursor: Buffer.from(c.createdAt.toISOString()).toString('base64')
            }));
      
            // 7. Total count
            const totalCount = await Community.count({ where: { ownerId: userId }, transaction });
      
            await transaction.commit();
            logger.info('Successfully fetched user owned communities', { userId, count: edges.length });
            
            return {
                edges,
                pageInfo: {
                    hasNextPage,
                    hasPreviousPage: !!cursor,
                    totalCount,
                    cursor: hasNextPage ? edges[edges.length - 1].cursor : null
                }
            };
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            logger.error('getUserOwnedCommunities error', { error, userId, limit, cursor });
            if (error instanceof GraphQLError) throw error;
      
            throw new GraphQLError('Failed to fetch owned communities', {
                extensions: { code: 'MY_OWNED_COMMUNITIES_FAILED', originalError: error.message }
            });
        }
    },

    async getCommunityById(communityId, userId) {
        let transaction;
        try {
            logger.info('Fetching community by ID', { communityId, userId });
            
            // 1. Validate input
            if (!communityId) {
                throw new GraphQLError('Missing or invalid communityId', {
                    extensions: { code: 'BAD_REQUEST_INPUT', field: 'communityId' }
                });
            }
            this.validateUUID(communityId, 'communityId');
            
            if (userId) {
                this.validateUUID(userId, 'userId');
            }

            // 2. Start transaction
            transaction = await sequelize.transaction();
            
            // 3. Fetch the community with optimized includes
            const community = await Community.findByPk(communityId, {
                include: [
                    { 
                        model: User, 
                        as: 'owner',
                        attributes: ['id', 'name', 'profileImageUrl', 'bio'],
                        required: false
                    },
                    { 
                        model: Interest, 
                        as: 'interests',
                        attributes: ['id', 'name', 'category', 'icon'],
                        required: false
                    },
                    { 
                        model: User, 
                        as: 'admins', 
                        through: { where: { role: 'ADMIN', status: 'APPROVED' } },
                        attributes: ['id', 'name', 'profileImageUrl'],
                        required: false
                    },
                    { 
                        model: User, 
                        as: 'moderators', 
                        through: { where: { role: 'MODERATOR', status: 'APPROVED' } },
                        attributes: ['id', 'name', 'profileImageUrl'],
                        required: false
                    }
                ],
                transaction
            });
            
            if (!community) {
                throw new GraphQLError('Community not found', {
                    extensions: { code: 'COMMUNITY_NOT_FOUND', field: 'communityId' }
                });
            }

            // 4. If userId is provided, compute permissions and membership status
            if (userId) {
                // Check if user exists
                const user = await User.findByPk(userId, { attributes: ['id'], transaction });
                if (!user) {
                    throw new GraphQLError('User not found', {
                        extensions: { code: 'USER_NOT_FOUND', field: 'userId' }
                    });
                }
                
                community.isOwner = community.ownerId === userId;
                community.isAdmin = await this.isAdmin(community.id, userId, transaction);
                community.isModerator = await this.isModerator(community.id, userId, transaction);
                community.canCreateEvents = await this.canCreateEvents(community.id, userId, transaction);
                community.canPost = await this.canPost(community.id, userId, transaction);
                community.membershipStatus = await this.getMembershipStatus(community.id, userId, transaction);
            } else {
                community.isOwner = false;
                community.isAdmin = false;
                community.isModerator = false;
                community.canCreateEvents = false;
                community.canPost = false;
                community.membershipStatus = 'NOT_MEMBER';
            }
            
            await transaction.commit();
            logger.info('Successfully fetched community by ID', { communityId, userId });
            return community;
        } catch (error) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            // Log error with context
            logger.error('getCommunityById error', { error, communityId, userId });
            if (error instanceof GraphQLError) throw error;
            throw new GraphQLError('Failed to fetch community', {
                extensions: { code: 'GET_COMMUNITY_FAILED', originalError: error.message }
            });
        }
    },

    /**
     * Checks if a user has access to view members of a community.
     * Only APPROVED members can access. Throws for PENDING, REJECTED, BANNED, or non-members.
     * @param {string} communityId - Community UUID
     * @param {string} userId - User UUID
     * @returns {Promise<void>} Throws GraphQLError if not allowed
     */
    async checkMembershipAccess(communityId, userId) {
        // Validate input
        if (!communityId || !userId) {
            throw new GraphQLError('Something went wrong. Please try again later.', {
                extensions: { code: 'BAD_REQUEST_INPUT' }
            });
        }
    
        this.validateUUID(communityId, 'communityId');
        this.validateUUID(userId, 'userId');
    
        // Check community existence
        const community = await Community.findByPk(communityId);
        if (!community) {
            throw new GraphQLError('The community you are trying to access does not exist.', {
                extensions: { code: 'COMMUNITY_NOT_FOUND' }
            });
        }
    
        // Check membership
        const membership = await CommunityMember.findOne({
            where: { communityId, userId }
        });
    
        if (!membership) {
            throw new GraphQLError('You need to join this community to access its content.', {
                extensions: { code: 'NOT_A_MEMBER' }
            });
        }
    
        if (membership.status === 'BANNED') {
            throw new GraphQLError('You have been banned from this community.', {
                extensions: { code: 'BANNED' }
            });
        }
    
        if (membership.status === 'REJECTED') {
            throw new GraphQLError('Your request to join this community was rejected.', {
                extensions: { code: 'REJECTED' }
            });
        }
    
        if (membership.status === 'PENDING') {
            throw new GraphQLError('Your request to join this community is still pending approval.', {
                extensions: { code: 'PENDING' }
            });
        }
    
        // Only APPROVED members allowed
        return;
    },

    /**
     * Checks if a user has access to view the community wall (posts).
     * Only APPROVED members can access. Throws for PENDING, REJECTED, BANNED, or non-members.
     * @param {string} communityId - Community UUID
     * @param {string} userId - User UUID
     * @returns {Promise<void>} Throws GraphQLError if not allowed
     */
    async checkWallAccess(communityId, userId) {
        // Validate input
        if (!communityId || !userId) {
            throw new GraphQLError('Something went wrong. Please try again later.', {
                extensions: { code: 'BAD_REQUEST_INPUT' }
            });
        }
        this.validateUUID(communityId, 'communityId');
        this.validateUUID(userId, 'userId');

        // Check community existence
        const community = await Community.findByPk(communityId);
        if (!community) {
            throw new GraphQLError('The community you are trying to access does not exist.', {
                extensions: { code: 'COMMUNITY_NOT_FOUND' }
            });
        }

        // Check membership
        const membership = await CommunityMember.findOne({
            where: { communityId, userId }
        });
        if (!membership) {
            throw new GraphQLError('You need to join this community to access its content.', {
                extensions: { code: 'NOT_A_MEMBER' }
            });
        }
        if (membership.status === 'BANNED') {
            throw new GraphQLError('You have been banned from this community.', {
                extensions: { code: 'BANNED' }
            });
        }
        if (membership.status === 'REJECTED') {
            throw new GraphQLError('Your request to join this community was rejected.', {
                extensions: { code: 'REJECTED' }
            });
        }
        if (membership.status === 'PENDING') {
            throw new GraphQLError('Your request to join this community is still pending approval.', {
                extensions: { code: 'PENDING' }
            });
        }
        // Only APPROVED members allowed
        return;
    },
};

module.exports = communityService;