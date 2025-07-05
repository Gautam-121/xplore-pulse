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
const { Op } = require("sequelize")
const { GraphQLError } = require('graphql');



const communityService = {

    // Helper methods
    validateInput(input, requiredFields) {
        for (const field of requiredFields) {
            if (!input[field]) {
                throw new UserInputError(`${field} is required`);
            }
        }
    },

    validateUUID(uuid, fieldName) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) {
            throw new UserInputError(`Invalid ${fieldName} format`);
        }
    },

    validateLocation(location) {
        if (!location.latitude || !location.longitude) {
            throw new UserInputError('Latitude and longitude are required for location');
        }

        if (location.latitude < -90 || location.latitude > 90) {
            throw new UserInputError('Latitude must be between -90 and 90');
        }

        if (location.longitude < -180 || location.longitude > 180) {
            throw new UserInputError('Longitude must be between -180 and 180');
        }
    },

    // Method 7: Hybrid Approach (Recommended)
    async generateUniqueSlugHybrid(name, providedSlug, transaction) {
        let baseSlug;

        if (providedSlug) {
            if (!/^[a-z0-9-]+$/.test(providedSlug)) {
                throw new UserInputError('Slug can only contain lowercase letters, numbers, and hyphens');
            }
            baseSlug = providedSlug;
        } else {
            baseSlug = this.sanitizeSlug(name);
        }

        if (!baseSlug) {
            throw new UserInputError('Invalid community name for slug generation');
        }

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
    },

    async discoverCommunities({ userId, limit, cursor, filters }) {
      try {
        const user = await User.findById(userId).populate('interests location');
        
        let query = Community.find();
        
        // Apply filters
        if (filters.interests && filters.interests.length > 0) {
          query = query.where('interests').in(filters.interests);
        }
        
        // Location-based filtering
        if (filters.location && filters.radius) {
          const radiusInRadians = filters.radius / 6371; // Earth radius in km
          query = query.where('location').near({
            center: [filters.location.longitude, filters.location.latitude],
            maxDistance: radiusInRadians,
            spherical: true
          });
        }
        
        // Other filters
        if (filters.isPaid !== undefined) {
          query = query.where('isPaid').equals(filters.isPaid);
        }
        
        if (filters.isPrivate !== undefined) {
          query = query.where('isPrivate').equals(filters.isPrivate);
        }
        
        if (filters.memberCountMin) {
          query = query.where('memberCount').gte(filters.memberCountMin);
        }
        
        if (filters.memberCountMax) {
          query = query.where('memberCount').lte(filters.memberCountMax);
        }
        
        // Exclude communities user is already a member of
        const userMemberships = await CommunityMember.find({
          userId,
          status: { $in: ['MEMBER', 'PENDING'] }
        }).select('communityId');
        
        const excludedCommunityIds = userMemberships.map(m => m.communityId);
        if (excludedCommunityIds.length > 0) {
          query = query.where('_id').nin(excludedCommunityIds);
        }
        
        // Sorting
        switch (filters.sortBy) {
          case 'MEMBER_COUNT':
            query = query.sort({ memberCount: filters.sortOrder === 'ASC' ? 1 : -1 });
            break;
          case 'ACTIVITY':
            query = query.sort({ lastActivityAt: -1 });
            break;
          case 'DISTANCE':
            // Distance sorting is handled by the near query
            break;
          case 'RELEVANCE':
            // Calculate relevance score based on user interests
            const userInterestIds = user.interests.map(i => i._id);
            // This would require a more complex aggregation pipeline
            break;
          default:
            query = query.sort({ createdAt: -1 });
        }
        
        // Pagination
        if (cursor) {
          const decodedCursor = Buffer.from(cursor, 'base64').toString('ascii');
          const cursorData = JSON.parse(decodedCursor);
          query = query.where('_id').gt(cursorData.id);
        }
        
        query = query.limit(limit + 1);
        
        const communities = await query
          .populate('owner interests')
          .exec();
        
        const hasNextPage = communities.length > limit;
        const edges = communities.slice(0, limit).map(community => ({
          node: community,
          cursor: Buffer.from(JSON.stringify({ id: community._id })).toString('base64')
        }));
        
        const totalCount = await Community.countDocuments(query.getQuery());
        
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
        console.error('Error discovering communities:', error);
        throw new Error('Failed to discover communities');
      }
    },
  
    async createCommunity(input) {
        const transaction = await sequelize.transaction();
        try {
          // Validate required fields
          this.validateInput(input, ['name', 'description', 'ownerId']);
          this.validateUUID(input.ownerId, 'ownerId');
          
          // Check if owner exists and is active
          const owner = await User.findByPk(input.ownerId, { transaction });
          
          if (!owner) {
            throw new GraphQLError('Owner not found' , {
                extensions: { code: "OWNER_NOT_FOUND"}
            });
          }
          
          if (!owner.isActive) {
            throw new GraphQLError('Owner account is not active' , {
                extensions: { code: "ACCOUNT_DEACTIVATE"}
            });
          }
          
          // Generate and validate slug
          const slug = await this.generateUniqueSlugHybrid(
            input.name, 
            input.slug, 
            transaction
          );
          
          // Validate interests exist
          if (input.interests && input.interests.length > 0) {
            const interestCount = await Interest.count({
              where: { id: { [Op.in]: input.interests } },
              transaction
            });
            
            if (interestCount !== input.interests.length) {
              throw new UserInputError('One or more interests not found');
            }
          }
          
          // Validate location if provided
          if (input.location) {
            this.validateLocation(input.location);
          }
          
          // Prepare community data
          const communityData = {
            name: input.name.trim(),
            description: input.description.trim(),
            slug,
            imageUrl: input.imageUrl || null,
            coverImageUrl: input.coverImageUrl || null,
            isPrivate: input.isPrivate || false,
            isPaid: input.isPaid || false,
            price: input.isPaid ? input.price : null,
            currency: input.isPaid ? (input.currency || 'USD') : null,
            ownerId: input.ownerId,
            memberCount: 1, // Owner is the first member
            postCount: 0,
            eventCount: 0,
            location: input.location ? {
              latitude: input.location.latitude,
              longitude: input.location.longitude,
              address: input.location.address || null,
              city: input.location.city || null,
              state: input.location.state || null,
              country: input.location.country || null,
              zipCode: input.location.zipCode || null
            } : null
          };
          
          // Create community
          const community = await Community.create(communityData, { transaction });
          
          // Add owner as member with OWNER role
          await CommunityMember.create({
            userId: input.ownerId,
            communityId: community.id,
            role: 'OWNER',
            status: 'APPROVED',
            joinedAt: new Date(),
            requestedAt: new Date()
          }, { transaction });
          
          // Associate interests
          if (input.interests && input.interests.length > 0) {
            const interests = await Interest.findAll({
              where: { id: { [Op.in]: input.interests } },
              transaction
            });
            await community.setInterests(interests, { transaction });
          }
          
          // Update user's owned communities count
          await User.increment('ownedCommunitiesCount', {
            where: { id: input.ownerId },
            transaction
          });
          
          await transaction.commit();
          
          // Fetch the complete community with all relations
          const completeCommunity = await Community.findByPk(community.id, {
            include: [
              {
                model: User,
                as: 'owner',
              },
              {
                model: Interest,
                as: 'interests',
              },
              {
                model: User,
                as: 'admins',
                through: {
                  where: { role: 'ADMIN', status: 'APPROVED' }
                }
              },
              {
                model: User,
                as: 'moderators',
                through: {
                  where: { role: 'MODERATOR', status: 'APPROVED' }
                }
              }
            ]
          });
          
          
          return completeCommunity;
          
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      },
  
    async joinCommunity(communityId, userId) {
      try {
        const community = await Community.findById(communityId);
        if (!community) {
          throw new Error('Community not found');
        }
        
        // Check if user is already a member
        const existingMembership = await CommunityMember.findOne({
          userId,
          communityId,
          status: { $in: ['MEMBER', 'PENDING'] }
        });
        
        if (existingMembership) {
          throw new Error('User is already a member or has pending request');
        }
        
        let membershipStatus = 'MEMBER';
        let joinedAt = new Date();
        
        // For private communities, create pending request
        if (community.isPrivate) {
          membershipStatus = 'PENDING';
          joinedAt = null;
        }
        
        // For paid communities, check payment
        if (community.isPaid) {
          // Handle payment logic here
          // This would integrate with your payment service
          const paymentResult = await this.processPayment(userId, community.price, community.currency);
          if (!paymentResult.success) {
            throw new Error('Payment failed');
          }
        }
        
        const membership = new CommunityMember({
          userId,
          communityId,
          role: 'MEMBER',
          status: membershipStatus,
          requestedAt: new Date(),
          joinedAt
        });
        
        await membership.save();
        
        // Update member count for approved members
        if (membershipStatus === 'MEMBER') {
          await Community.findByIdAndUpdate(communityId, {
            $inc: { memberCount: 1 }
          });
        }
        
        // Send notification to community owners/admins for private communities
        if (community.isPrivate) {
          await this.notifyAdminsOfNewRequest(communityId, userId);
        }
        
        return true;
      } catch (error) {
        console.error('Error joining community:', error);
        throw error;
      }
    },
  
    async approveMemberRequest(communityId, userId) {
      try {
        const membership = await CommunityMember.findOne({
          userId,
          communityId,
          status: 'PENDING'
        });
        
        if (!membership) {
          throw new Error('Pending membership request not found');
        }
        
        membership.status = 'APPROVED';
        membership.joinedAt = new Date();
        await membership.save();
        
        // Update member count
        await Community.findByIdAndUpdate(communityId, {
          $inc: { memberCount: 1 }
        });
        
        // Send notification to user
        await this.notifyUserOfApproval(communityId, userId);
        
        return true;
      } catch (error) {
        console.error('Error approving member request:', error);
        throw error;
      }
    },
  
    async getCommunityWall({ communityId, userId, limit, cursor, postType }) {
      try {
        let query = CommunityPost.find({ communityId });
        
        if (postType) {
          query = query.where('type').equals(postType);
        }
        
        // Only show posts user has access to
        query = query.where('$or', [
          { isPaid: false },
          { authorId: userId },
          // Add logic for paid content access
        ]);
        
        if (cursor) {
          const decodedCursor = Buffer.from(cursor, 'base64').toString('ascii');
          const cursorData = JSON.parse(decodedCursor);
          query = query.where('_id').lt(cursorData.id);
        }
        
        query = query.sort({ createdAt: -1 }).limit(limit + 1);
        
        const posts = await query
          .populate('author community')
          .exec();
        
        const hasNextPage = posts.length > limit;
        const edges = posts.slice(0, limit).map(post => ({
          node: post,
          cursor: Buffer.from(JSON.stringify({ id: post._id })).toString('base64')
        }));
        
        const totalCount = await CommunityPost.countDocuments({ communityId });
        
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
        console.error('Error fetching community wall:', error);
        throw error;
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
      const membership = await CommunityMember.findOne({
        userId,
        communityId,
        role: { $in: ['OWNER', 'ADMIN'] },
        status: 'APPROVED'
      });
      
      if (!membership) {
        throw new Error('Insufficient permissions');
      }
    },
  
    async checkOwnerAccess(communityId, userId) {
      const community = await Community.findById(communityId);
      if (!community || community.ownerId.toString() !== userId) {
        throw new Error('Only community owner can perform this action');
      }
    },
  
    async getMembershipStatus(communityId, userId) {
      const membership = await CommunityMember.findOne({
        userId,
        communityId
      });
      
      if (!membership) return 'NOT_MEMBER';
      
      switch (membership.status) {
        case 'APPROVED': return 'MEMBER';
        case 'PENDING': return 'PENDING';
        case 'REJECTED': return 'REJECTED';
        default: return 'NOT_MEMBER';
      }
    },

    async isAdmin(communityId, userId) {
        if (!userId) return false;

        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED',
                role: { [Op.in]: ['OWNER', 'ADMIN'] }
            }
        });

        return !!membership;
    },

    async isModerator(communityId, userId) {
        if (!userId) return false;

        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED',
                role: { [Op.in]: ['OWNER', 'ADMIN', 'MODERATOR'] }
            }
        });

        return !!membership;
    },

    async canPost(communityId, userId) {
        if (!userId) return false;

        try {
            await this.checkPostAccess(communityId, userId);
            return true;
        } catch {
            return false;
        }
    },

    async canCreateEvents(communityId, userId) {
        if (!userId) return false;

        const community = await Community.findByPk(communityId);
        if (!community) return false;

        const membership = await CommunityMember.findOne({
            where: {
                communityId,
                userId,
                status: 'APPROVED'
            }
        });

        if (!membership) return false;

        // Check community settings
        if (!community.settings.allowMemberEvents &&
            !['OWNER', 'ADMIN'].includes(membership.role)) {
            return false;
        }

        return true;
    },

    async searchCommunities({ userId, query, limit, cursor, filters }) {
        try {
          const searchQuery = {
            $or: [
              { name: { $regex: query, $options: 'i' } },
              { description: { $regex: query, $options: 'i' } },
              { 'interests.name': { $regex: query, $options: 'i' } }
            ]
          };
    
          // Apply additional filters
          if (filters.interests && filters.interests.length > 0) {
            searchQuery.interests = { $in: filters.interests };
          }
    
          if (filters.location && filters.radius) {
            const radiusInRadians = filters.radius / 6371;
            searchQuery.location = {
              $near: {
                $geometry: {
                  type: 'Point',
                  coordinates: [filters.location.longitude, filters.location.latitude]
                },
                $maxDistance: filters.radius * 1000 // Convert km to meters
              }
            };
          }
    
          let mongoQuery = Community.find(searchQuery);
    
          // Exclude user's communities
          const userMemberships = await CommunityMember.find({
            userId,
            status: { $in: ['MEMBER', 'PENDING'] }
          }).select('communityId');
          
          const excludedIds = userMemberships.map(m => m.communityId);
          if (excludedIds.length > 0) {
            mongoQuery = mongoQuery.where('_id').nin(excludedIds);
          }
    
          // Pagination and sorting
          if (cursor) {
            const decodedCursor = Buffer.from(cursor, 'base64').toString('ascii');
            const cursorData = JSON.parse(decodedCursor);
            mongoQuery = mongoQuery.where('_id').gt(cursorData.id);
          }
    
          mongoQuery = mongoQuery
            .sort({ memberCount: -1, createdAt: -1 })
            .limit(limit + 1)
            .populate('owner interests');
    
          const communities = await mongoQuery.exec();
          
          const hasNextPage = communities.length > limit;
          const edges = communities.slice(0, limit).map(community => ({
            node: community,
            cursor: Buffer.from(JSON.stringify({ id: community._id })).toString('base64')
          }));
    
          const totalCount = await Community.countDocuments(searchQuery);
    
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
          console.error('Error searching communities:', error);
          throw new Error('Failed to search communities');
        }
      },
    
    async getCommunityMembers({ communityId, limit, cursor, role, status }) {
        try {
          let query = CommunityMember.find({ communityId });
    
          if (role) {
            query = query.where('role').equals(role);
          }
    
          if (status) {
            query = query.where('status').equals(status);
          }
    
          if (cursor) {
            const decodedCursor = Buffer.from(cursor, 'base64').toString('ascii');
            const cursorData = JSON.parse(decodedCursor);
            query = query.where('_id').gt(cursorData.id);
          }
    
          query = query
            .sort({ joinedAt: -1 })
            .limit(limit + 1)
            .populate('userId', 'name profileImageUrl bio');
    
          const members = await query.exec();
          
          const hasNextPage = members.length > limit;
          const edges = members.slice(0, limit).map(member => ({
            node: member,
            cursor: Buffer.from(JSON.stringify({ id: member._id })).toString('base64')
          }));
    
          const totalCount = await CommunityMember.countDocuments({ 
            communityId,
            ...(role && { role }),
            ...(status && { status })
          });
    
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
          console.error('Error fetching community members:', error);
          throw new Error('Failed to fetch community members');
        }
    },
    
    async getTrendingCommunities({ userId, limit, timeframe }) {
        try {
          const timeframeDate = new Date();
          switch (timeframe) {
            case 'day':
              timeframeDate.setDate(timeframeDate.getDate() - 1);
              break;
            case 'week':
              timeframeDate.setDate(timeframeDate.getDate() - 7);
              break;
            case 'month':
              timeframeDate.setMonth(timeframeDate.getMonth() - 1);
              break;
            default:
              timeframeDate.setDate(timeframeDate.getDate() - 7);
          }
    
          // Calculate trending score based on recent activity
          const trendingCommunities = await Community.aggregate([
            {
              $lookup: {
                from: 'communityposts',
                localField: '_id',
                foreignField: 'communityId',
                as: 'recentPosts',
                pipeline: [
                  {
                    $match: {
                      createdAt: { $gte: timeframeDate }
                    }
                  }
                ]
              }
            },
            {
              $lookup: {
                from: 'communitymembers',
                localField: '_id',
                foreignField: 'communityId',
                as: 'recentMembers',
                pipeline: [
                  {
                    $match: {
                      joinedAt: { $gte: timeframeDate },
                      status: 'APPROVED'
                    }
                  }
                ]
              }
            },
            {
              $addFields: {
                trendingScore: {
                  $add: [
                    { $multiply: [{ $size: '$recentPosts' }, 2] },
                    { $multiply: [{ $size: '$recentMembers' }, 5] },
                    { $divide: ['$memberCount', 10] }
                  ]
                }
              }
            },
            {
              $match: {
                trendingScore: { $gt: 0 },
                isPrivate: false
              }
            },
            {
              $sort: { trendingScore: -1 }
            },
            {
              $limit: limit
            }
          ]);
    
          // Populate owner and interests
          await Community.populate(trendingCommunities, [
            { path: 'ownerId', select: 'name profileImageUrl' },
            { path: 'interests', select: 'name category icon' }
          ]);
    
          return trendingCommunities;
        } catch (error) {
          console.error('Error fetching trending communities:', error);
          throw new Error('Failed to fetch trending communities');
        }
    },
    
    async getRecommendedCommunities({ userId, limit }) {
        try {
          const user = await User.findById(userId).populate('interests');
          const userInterestIds = user.interests.map(i => i._id);
    
          // Get communities user is not already a member of
          const userMemberships = await CommunityMember.find({
            userId,
            status: { $in: ['MEMBER', 'PENDING'] }
          }).select('communityId');
          
          const excludedIds = userMemberships.map(m => m.communityId);
    
          // Find communities with matching interests
          const recommendations = await Community.aggregate([
            {
              $match: {
                _id: { $nin: excludedIds },
                interests: { $in: userInterestIds },
                isPrivate: false
              }
            },
            {
              $addFields: {
                matchingInterests: {
                  $size: {
                    $setIntersection: ['$interests', userInterestIds]
                  }
                },
                relevanceScore: {
                  $add: [
                    { $multiply: ['$matchingInterests', 10] },
                    { $divide: ['$memberCount', 100] },
                    { $cond: [{ $eq: ['$isPaid', false] }, 5, 0] }
                  ]
                }
              }
            },
            {
              $sort: { relevanceScore: -1, memberCount: -1 }
            },
            {
              $limit: limit
            }
          ]);
    
          await Community.populate(recommendations, [
            { path: 'ownerId', select: 'name profileImageUrl' },
            { path: 'interests', select: 'name category icon' }
          ]);
    
          return recommendations;
        } catch (error) {
          console.error('Error fetching recommended communities:', error);
          throw new Error('Failed to fetch recommended communities');
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

  async notifyAdminsOfNewRequest(communityId, userId) {
    // Send notifications to community admins
    const admins = await CommunityMember.find({
      communityId,
      role: { $in: ['OWNER', 'ADMIN'] },
      status: 'APPROVED'
    }).populate('userId');

    // Send notification logic here
    console.log(`New member request for community ${communityId} from user ${userId}`);
  },

  async notifyUserOfApproval(communityId, userId) {
    // Send approval notification to user
    console.log(`User ${userId} approved for community ${communityId}`);
  },

  async sendEventRegistrationConfirmation(userId, postId, ticketCode) {
    // Send event registration confirmation
    console.log(`Event registration confirmed for user ${userId}, ticket: ${ticketCode}`);
  }
};

module.exports = communityService