const { requireAuth } = require("../middleware/auth");
const communityService = require("../services/communityService")
const { GraphQLError } = require('graphql');

const resolvers = {
    Query: {
      discoverCommunities: async (parent, args, context) => {
        const { user } = context;
        const { first, after, filters } = args;
        
        return await communityService.discoverCommunities({
          userId: user.id,
          limit: first,
          cursor: after,
          filters: filters || {}
        });
      },
  
      searchCommunities: async (parent, args, context) => {
        const { user } = context;
        const { query, first, after, filters } = args;
        
        return await communityService.searchCommunities({
          userId: user.id,
          query,
          limit: first,
          cursor: after,
          filters: filters || {}
        });
      },
  
      myJoinedCommunities: async (parent, args, context) => {
        const { user } = context;
        const { first, after } = args;
        
        return await communityService.getUserJoinedCommunities({
          userId: user.id,
          limit: first,
          cursor: after
        });
      },
  
      myOwnedCommunities: async (parent, args, context) => {
        const { user } = context;
        const { first, after } = args;
        
        return await communityService.getUserOwnedCommunities({
          userId: user.id,
          limit: first,
          cursor: after
        });
      },
  
      community: async (parent, args, context) => {
        const { user } = context;
        const { id } = args;
        
        return await communityService.getCommunityById(id, user.id);
      },
  
      communityMembers: async (parent, args, context) => {
        const { user } = context;
        const { communityId, first, after, role, status } = args;
        
        // Check if user has permission to view members
        await communityService.checkMembershipAccess(communityId, user.id);
        
        return await communityService.getCommunityMembers({
          communityId,
          limit: first,
          cursor: after,
          role,
          status
        });
      },
  
      pendingMemberRequests: async (parent, args, context) => {
        const { user } = context;
        const { communityId, first, after } = args;
        
        // Check if user is owner/admin
        await communityService.checkAdminAccess(communityId, user.id);
        
        return await communityService.getPendingMemberRequests({
          communityId,
          limit: first,
          cursor: after
        });
      },
  
      communityWall: async (parent, args, context) => {
        const { user } = context;
        const { communityId, first, after, postType } = args;
        
        // Check if user has access to community wall
        await communityService.checkWallAccess(communityId, user.id);
        
        return await communityService.getCommunityWall({
          communityId,
          userId: user.id,
          limit: first,
          cursor: after,
          postType
        });
      },
  
      trendingCommunities: async (parent, args, context) => {
        const { user } = context;
        const { first, timeframe } = args;
        
        return await communityService.getTrendingCommunities({
          userId: user.id,
          limit: first,
          timeframe
        });
      },
  
      recommendedCommunities: async (parent, args, context) => {
        const { user } = context;
        const { first } = args;
        
        return await communityService.getRecommendedCommunities({
          userId: user.id,
          limit: first
        });
      }
    },
  
    Mutation: {
        createCommunity: requireAuth(async (parent, args, context) => {
            try {
                const { input } = args;

                // Validate input
                if (!input.name || input.name.trim().length === 0) {
                    throw new GraphQLError('Community name is required', {
                        extensions: { code: 'INVALID_INPUT', field: 'name' }
                    });
                }

                if (!input.description || input.description.trim().length === 0) {
                    throw new GraphQLError('Community description is required', {
                        extensions: { code: 'INVALID_INPUT', field: 'description' }
                    });
                }

                if (!input.interests || input.interests.length === 0) {
                    throw new GraphQLError('At least one interest is required', {
                        extensions: { code: 'INVALID_INPUT', field: 'interests' }
                    });
                }

                if (input.isPaid && (!input.price || input.price <= 0)) {
                    throw new GraphQLError('Price must be greater than 0 for paid communities', {
                        extensions: { code: 'INVALID_INPUT', field: 'price' }
                    });
                }

                if (input.name.length > 100) {
                    throw new GraphQLError('Community name must be less than 100 characters', {
                        extensions: { code: 'INVALID_INPUT', field: 'name' }
                    });
                }

                if (input.description.length > 1000) {
                    throw new GraphQLError('Community description must be less than 1000 characters', {
                        extensions: { code: 'INVALID_INPUT', field: 'description' }
                    });
                }

                // Create community with owner ID
                const communityData = {
                    ...input,
                    ownerId: context.user.id
                };

                const community = await communityService.createCommunity(communityData);

                // Return the created community with all related data
                return community;

            } catch (error) {
                if (error instanceof GraphQLError) throw error;

                // Handle specific database errors
                if (error.name === 'SequelizeUniqueConstraintError') {
                    throw new GraphQLError('Community name or slug already exists', {
                        extensions: { code: 'DUPLICATE_COMMUNITY' }
                    });
                }

                if (error.name === 'SequelizeValidationError') {
                    throw new GraphQLError(`Validation error: ${error.message}`, {
                        extensions: { code: 'VALIDATION_ERROR' }
                    });
                }

                console.error('Community creation error:', error);
                throw new GraphQLError('Failed to create community', {
                    extensions: { code: 'COMMUNITY_CREATE_FAILED' }
                });
            }
        }),
  
      updateCommunity: async (parent, args, context) => {
        const { user } = context;
        const { id, input } = args;
        
        // Check if user is owner
        await communityService.checkOwnerAccess(id, user.id);
        
        return await communityService.updateCommunity(id, input);
      },
  
      deleteCommunity: async (parent, args, context) => {
        const { user } = context;
        const { id } = args;
        
        // Check if user is owner
        await communityService.checkOwnerAccess(id, user.id);
        
        return await communityService.deleteCommunity(id);
      },
  
      joinCommunity: async (parent, args, context) => {
        const { user } = context;
        const { communityId } = args;
        
        return await communityService.joinCommunity(communityId, user.id);
      },
  
      leaveCommunity: async (parent, args, context) => {
        const { user } = context;
        const { communityId } = args;
        
        return await communityService.leaveCommunity(communityId, user.id);
      },
  
      approveMemberRequest: async (parent, args, context) => {
        const { user } = context;
        const { communityId, userId } = args;
        
        // Check if user is owner/admin
        await communityService.checkAdminAccess(communityId, user.id);
        
        return await communityService.approveMemberRequest(communityId, userId);
      },
  
      rejectMemberRequest: async (parent, args, context) => {
        const { user } = context;
        const { communityId, userId } = args;
        
        // Check if user is owner/admin
        await communityService.checkAdminAccess(communityId, user.id);
        
        return await communityService.rejectMemberRequest(communityId, userId);
      },
  
      assignMemberRole: async (parent, args, context) => {
        const { user } = context;
        const { communityId, userId, role } = args;
        
        // Check if user is owner (only owners can assign roles)
        await communityService.checkOwnerAccess(communityId, user.id);
        
        return await communityService.assignMemberRole(communityId, userId, role);
      },
  
      banMember: async (parent, args, context) => {
        const { user } = context;
        const { communityId, userId, reason } = args;
        
        // Check if user is owner/admin
        await communityService.checkAdminAccess(communityId, user.id);
        
        return await communityService.banMember(communityId, userId, reason);
      },
  
      createCommunityPost: async (parent, args, context) => {
        const { user } = context;
        const { input } = args;
        
        // Check if user can post in community
        await communityService.checkPostAccess(input.communityId, user.id);
        
        return await communityService.createCommunityPost({
          ...input,
          authorId: user.id
        });
      },
  
      registerForEvent: async (parent, args, context) => {
        const { user } = context;
        const { postId } = args;
        
        return await communityService.registerForEvent(postId, user.id);
      }
    },
  
    // Field Resolvers
    Community: {
      membershipStatus: async (parent, args, context) => {
        const { user } = context;
        return await communityService.getMembershipStatus(parent.id, user.id);
      },
  
      isOwner: async (parent, args, context) => {
        const { user } = context;
        return parent.ownerId === user.id;
      },
  
      isAdmin: async (parent, args, context) => {
        const { user } = context;
        return await communityService.isAdmin(parent.id, user.id);
      },
  
      isModerator: async (parent, args, context) => {
        const { user } = context;
        return await communityService.isModerator(parent.id, user.id);
      },
  
      canPost: async (parent, args, context) => {
        const { user } = context;
        return await communityService.canPost(parent.id, user.id);
      },
  
      canCreateEvents: async (parent, args, context) => {
        const { user } = context;
        return await communityService.canCreateEvents(parent.id, user.id);
      }
    },
  
    CommunityPost: {
      isLiked: async (parent, args, context) => {
        const { user } = context;
        return await postService.isLikedByUser(parent.id, user.id);
      },
  
      isBookmarked: async (parent, args, context) => {
        const { user } = context;
        return await postService.isBookmarkedByUser(parent.id, user.id);
      }
    },
  
    EventDetails: {
      isRegistered: async (parent, args, context) => {
        const { user } = context;
        return await eventService.isRegistered(parent.postId, user.id);
      }
    }
  
}

module.exports = resolvers