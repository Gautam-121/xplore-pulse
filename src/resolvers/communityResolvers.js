const { requireAuth } = require("../middleware/auth");
const communityService = require("../services/communityService")
const { GraphQLError } = require('graphql');
const ValidationService = require("../utils/validation");
const logger = require("../utils/logger");

const resolvers = {
    Query: {
      discoverCommunities: requireAuth(async (parent, args, context) => {
        const { user, loaders } = context;
        const { first, after, filters } = args;
        try {
          const result = await communityService.discoverCommunities({
            userId: user.id,
            limit: first,
            cursor: after,
            filters: filters || {}
          });

          // Use DataLoader to batch load related data
          const communityIds = result.edges.map(edge => edge.node.id);
          const ownerIds = result.edges.map(edge => edge.node.ownerId).filter(Boolean);

          // Batch load owners using DataLoader
          const owners = await Promise.all(
            ownerIds.map(id => loaders.userLoader.load(id))
          );

          // Attach owners to communities
          result.edges.forEach((edge, index) => {
            if (edge.node.ownerId) {
              const owner = owners.find(o => o && o.id === edge.node.ownerId);
              edge.node.owner = owner;
            }
          });

          return result;
        } catch (error) {
          logger.error('Error in discoverCommunities query', { error, userId: user?.id });
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to discover communities', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' }
          });
        }
      }),
  
      searchCommunities: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { query, first, after, filters } = args;
        return await communityService.searchCommunities({
          userId: user.id,
          query,
          limit: first,
          cursor: after,
          filters: filters || {}
        });
      }),
  
      myJoinedCommunities: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { first, after , status } = args;
        const result = await communityService.getUserJoinedCommunities({
          userId: user.id,
          limit: first,
          cursor: after,
          status: status
        });
        // Log the first community node
        if (result.edges.length > 0) {
          console.log('First community node:', result.edges[0].node);
        }
        return result;
      }),
  
      myOwnedCommunities: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { first, after } = args;
        
        return await communityService.getUserOwnedCommunities({
          userId: user.id,
          limit: first,
          cursor: after
        });
      }),
  
      community: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { id } = args;
        const sanitizeCommunityId = ValidationService.sanitizeUUID(id)
        ValidationService.validateUUID(sanitizeCommunityId , "communityId")
        await communityService.checkMembershipAccess(sanitizeCommunityId, user.id);
        return await communityService.getCommunityById(sanitizeCommunityId, user.id);
      }),
  
      communityMembers: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, first, after, role, status } = args;
        const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId)
        ValidationService.validateUUID(sanitizeCommunityId)

        // Check if user has permission to view members
        await communityService.checkMembershipAccess(sanitizeCommunityId, user.id);
        return await communityService.getCommunityMembers(
          sanitizeCommunityId,
          first,
          after,
          role,
          status,
          user.id
        );
      }),
  
      pendingMemberRequests: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, first, after } = args;
        const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId)
        ValidationService.validateUUID(sanitizeCommunityId)
        
        // Check if user is owner/admin
        await communityService.checkAdminAccess(sanitizeCommunityId, user.id);
        return await communityService.getPendingMemberRequests(
          sanitizeCommunityId,
          first,
          after
        );
      }),

      recommendedCommunities: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { first } = args;
        return await communityService.getRecommendedCommunities({
          userId: user.id,
          limit: first
        });
      })
    },
  
    Mutation: {
      createCommunity: requireAuth(async (parent, args, context) => {
        try {
          const { input } = args;
          const sanitizeName = ValidationService.sanitizeName(input.name)
          const sanitizeDescription = ValidationService.sanitizeBio(input.description)
          ValidationService.validateName(sanitizeName)
          ValidationService.validateBio(sanitizeDescription, "description")
          if (input.isPaid) {
            ValidationService.validatePrice(input?.price)
            ValidationService.validateCurrency(input.currency)
          }
          if (!input.interests || input.interests.length === 0) {
            throw new GraphQLError('At least one interest is required', {
              extensions: { code: 'INVALID_INPUT', field: 'interests' }
            });
          }
          ValidationService.validateArrayOfUUIDs(input?.interests, "interest")
          if(input.location){
            ValidationService.validateLatitude(input.location?.latitude)
            ValidationService.validateLongitude(input.location?.longitude)
          }

          // Validate imageUrl and coverImageUrl if provided
          if (input.imageUrl) {
            ValidationService.validateImageUrl(input.imageUrl, 'imageUrl');
          }
          if (input.coverImageUrl) {
            ValidationService.validateImageUrl(input.coverImageUrl, 'coverImageUrl');
          }

          // New: Expect imageUrl and coverImageUrl as URLs (strings), not Uploads
          // The client should upload files first using uploadFile mutation, then pass the URLs here

          // Create community with owner ID
          const communityData = {
            ...input,
            name: sanitizeName,
            description: sanitizeDescription,
            ownerId: context.user.id,
            userId: context.user.id
          };
          const community = await communityService.createCommunity(communityData);
          // Return the created community with all related data
          return community;

        } catch (error) {
          logger.error('Community creation error:', { error });
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

          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to create community', {
            extensions: { code: 'COMMUNITY_CREATE_FAILED' }
          });
        }
      }),
  
      updateCommunity: requireAuth(async (parent, args, context) => {
        try {
          const { user } = context;
          const { id, input } = args;
          const sanitizeId = ValidationService.sanitizeUUID(id);
          ValidationService.validateUUID(sanitizeId, "communityId");

          // Validate and sanitize only provided fields
          if (input.name !== undefined) {
            input.name = ValidationService.sanitizeName(input.name);
            ValidationService.validateName(input.name);
          }
          if (input.description !== undefined) {
            input.description = ValidationService.sanitizeBio(input.description);
            ValidationService.validateBio(input.description, "description");
          }
          if (input.interests !== undefined) {
            ValidationService.validateArrayOfUUIDs(input.interests, "interests");
          }
          if (input.location !== undefined) {
            if (input.location.latitude !== undefined) {
              ValidationService.validateLatitude(input.location.latitude);
            }
            if (input.location.longitude !== undefined) {
              ValidationService.validateLongitude(input.location.longitude);
            }
          }

          // Validate imageUrl and coverImageUrl if provided
          if (input.imageUrl) {
            ValidationService.validateImageUrl(input.imageUrl, 'imageUrl');
          }
          if (input.coverImageUrl) {
            ValidationService.validateImageUrl(input.coverImageUrl, 'coverImageUrl');
          }

          // New: Expect imageUrl and coverImageUrl as URLs (strings), not Uploads
          // The client should upload files first using uploadFile mutation, then pass the URLs here

          // Check if user is owner
          await communityService.checkOwnerAccess(sanitizeId, user.id);

          return await communityService.updateCommunity(sanitizeId, {
            ...input
          }, user.id);
        } catch (error) {
          logger.error('Community updation error:', { error });
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

          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to update community', {
            extensions: { code: 'COMMUNITY_UPDATE_FAILED' }
          });
        }
      }),
  
      deleteCommunity: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { id } = args;
        try {
          const sanitizeId = ValidationService.sanitizeUUID(id);
          ValidationService.validateUUID(sanitizeId, "communityId");
          await communityService.checkOwnerAccess(sanitizeId, user.id);
          return await communityService.deleteCommunity(sanitizeId, user.id);
        } catch (error) {
          logger.error('Community deletion error:', { error });
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
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to delete community', {
            extensions: { code: 'COMMUNITY_DELETE_FAILED' }
          });
        }
      }),
  
      joinCommunity: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId } = args;
        try {
          const sanitizeId = ValidationService.sanitizeUUID(communityId);
          ValidationService.validateUUID(sanitizeId, "communityId");
          return await communityService.joinCommunity(sanitizeId, user.id);
        } catch (error) {
          logger.error('Join community error:', { error });
          if (error.name === 'SequelizeUniqueConstraintError') {
            throw new GraphQLError('You have already requested to join this community.', {
              extensions: { code: 'ALREADY_REQUESTED' }
            });
          }
          if (error.name === 'SequelizeValidationError') {
            throw new GraphQLError(`Validation error: ${error.message}`, {
              extensions: { code: 'VALIDATION_ERROR' }
            });
          }
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to join community', {
            extensions: { code: 'JOIN_COMMUNITY_FAILED' }
          });
        }
      }),
  
      leaveCommunity: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId } = args;
        try {
          const sanitizeId = ValidationService.sanitizeUUID(communityId);
          ValidationService.validateUUID(sanitizeId, "communityId");
          return await communityService.leaveCommunity(sanitizeId, user.id);
        } catch (error) {
          logger.error('Leave community error:', { error });
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
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to leave community', {
            extensions: { code: 'LEAVE_COMMUNITY_FAILED' }
          });
        }
      }),
  
      approveMemberRequest: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId } = args;
        try {
          // Check if user is owner/admin
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
          const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
          ValidationService.validateUUID(sanitizeCommunityId, "communityId");
          ValidationService.validateUUID(sanitizeMemberId, "memberId");
          await communityService.checkAdminAccess(sanitizeCommunityId, user.id);
          return await communityService.approveMemberRequest(sanitizeCommunityId, sanitizeMemberId , user.id);
        } catch (error) {
          logger.error('Approve member request error:', { error });
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
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to approve member request', {
            extensions: { code: 'APPROVE_MEMBER_FAILED' }
          });
        }
      }),
  
      rejectMemberRequest: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId } = args;
        try {
          // Check if user is owner/admin
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
          const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
          ValidationService.validateUUID(sanitizeCommunityId, "communityId");
          ValidationService.validateUUID(sanitizeMemberId, "memberId");
          await communityService.checkAdminAccess(sanitizeCommunityId, user.id);
          return await communityService.rejectMemberRequest(sanitizeCommunityId, sanitizeMemberId, user.id);
        } catch (error) {
          logger.error('Reject member request error:', { error });
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
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to reject member request', {
            extensions: { code: 'REJECT_MEMBER_FAILED' }
          });
        }
      }),
  
      assignMemberRole: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId, role } = args;
        try {
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
          const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
          ValidationService.validateUUID(sanitizeCommunityId, "communityId");
          ValidationService.validateUUID(sanitizeMemberId, "memberId");
          await communityService.checkOwnerAccess(sanitizeCommunityId, user.id);
          return await communityService.assignMemberRole(sanitizeCommunityId, sanitizeMemberId, user.id, role);
        } catch (error) {
          logger.error('Assign member role error:', { error });
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
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to assign member role', {
            extensions: { code: 'ASSIGN_ROLE_FAILED' }
          });
        }
      }),
  
      removeMemberRole: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId } = args;
        try {
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
          const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
          ValidationService.validateUUID(sanitizeCommunityId, "communityId");
          ValidationService.validateUUID(sanitizeMemberId, "memberId");
          // Check if user is owner (only owners can remove roles)
          await communityService.checkOwnerAccess(sanitizeCommunityId, user.id);
          return await communityService.removeMemberRole(sanitizeCommunityId, sanitizeMemberId , user.id);
        } catch (error) {
          logger.error('Remove member role error:', { error });
          if (error.name === 'SequelizeUniqueConstraintError') {
            throw new GraphQLError('Could not remove role due to related records.', {
              extensions: { code: 'ASSIGN_ROLE_CONSTRAINT' }
            });
          }
          if (error.name === 'SequelizeValidationError') {
            throw new GraphQLError(`Validation error: ${error.message}`, {
              extensions: { code: 'VALIDATION_ERROR' }
            });
          }
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to remove member role', {
            extensions: { code: 'ASSIGN_ROLE_FAILED' }
          });
        }
      }),
  
      banMember: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId, reason } = args;
        try {
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
          const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
          ValidationService.validateUUID(sanitizeCommunityId, "communityId");
          ValidationService.validateUUID(sanitizeMemberId, "memberId");  
          // Check if user is owner (only owners can ban members)
          await communityService.checkOwnerAccess(sanitizeCommunityId, user.id);
          return await communityService.banMember(sanitizeCommunityId, sanitizeMemberId, user.id , reason);
        } catch (error) {
          logger.error('Ban member role error:', { error });
          if (error.name === 'SequelizeUniqueConstraintError') {
            throw new GraphQLError('Could not ban member due to related records.', {
              extensions: { code: 'ASSIGN_ROLE_CONSTRAINT' }
            });
          }
          if (error.name === 'SequelizeValidationError') {
            throw new GraphQLError(`Validation error: ${error.message}`, {
              extensions: { code: 'VALIDATION_ERROR' }
            });
          }
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to ban member', {
            extensions: { code: 'ASSIGN_ROLE_FAILED' }
          });
        }
      }),
  
      unbanMember: requireAuth(async (parent, args, context) => {
        const { user } = context;
        const { communityId, memberId } = args;
        try {
          const sanitizeCommunityId = ValidationService.sanitizeUUID(communityId);
            const sanitizeMemberId = ValidationService.sanitizeUUID(memberId);
            ValidationService.validateUUID(sanitizeCommunityId, "communityId");
            ValidationService.validateUUID(sanitizeMemberId, "memberId");
          // Check if user is owner (only owners can unban members)
          await communityService.checkOwnerAccess(sanitizeCommunityId, user.id);
          return await communityService.unbanMember(sanitizeCommunityId , sanitizeMemberId, user.id);
        } catch (error) {
          logger.error('Unban member role error:', { error });
          if (error.name === 'SequelizeUniqueConstraintError') {
            throw new GraphQLError('Could not unban member due to related records.', {
              extensions: { code: 'ASSIGN_ROLE_CONSTRAINT' }
            });
          }
          if (error.name === 'SequelizeValidationError') {
            throw new GraphQLError(`Validation error: ${error.message}`, {
              extensions: { code: 'VALIDATION_ERROR' }
            });
          }
          if (error instanceof GraphQLError) throw error;
          throw new GraphQLError('Failed to unban member', {
            extensions: { code: 'ASSIGN_ROLE_FAILED' }
          });
        }
      }),
  
    },
  
    // Field Resolvers - Using DataLoaders for performance
    Community: {
      membershipStatus: async (parent, args, context) => {
        console.log("MembershipStatus")
        const { user, loaders } = context;
        if (!user) return 'NOT_MEMBER';
        
        try {
          const status = await loaders.userMembershipStatusLoader.load({
            userId: user.id,
            communityId: parent.id
          });
          console.log("MemberShipStatus" , status)
          return status === "APPROVED" ? "MEMBER" : status;
        } catch (error) {
          logger.error('Error loading membership status', { error, userId: user.id, communityId: parent.id });
          return 'NOT_MEMBER';
        }
      },
  
      isOwner: (community, args, context) => {
        console.log("isOwner resolver:");
        if (!context || !context.user || !community || !community.ownerId) return false;
        return community.ownerId === context.user.id;
      },
  
      isAdmin: async (parent, args, context) => {
        console.log("isAdmin Resolver")
        const { user } = context;
        if (!user) return false;
        
        try {
          // Use the service method directly for now, could be optimized with DataLoader
          return await communityService.isAdmin(parent.id, user.id);
        } catch (error) {
          logger.error('Error loading admin status', { error, userId: user.id, communityId: parent.id });
          return false;
        }
      },
  
      isModerator: async (parent, args, context) => {
        console.log("isModerator Resolver")
        const { user } = context;
        if (!user) return false;
        
        try {
          // Use the service method directly for now, could be optimized with DataLoader
          return await communityService.isModerator(parent.id, user.id);
        } catch (error) {
          logger.error('Error loading moderator status', { error, userId: user.id, communityId: parent.id });
          return false;
        }
      },
  
      canPost: async (parent, args, context) => {
        console.log("CanPost Resolver")
        const { user } = context;
        if (!user) return false;
        
        try {
          // Use the service method directly for now, could be optimized with DataLoader
          return await communityService.canPost(parent.id, user.id);
        } catch (error) {
          logger.error('Error loading post permission', { error, userId: user.id, communityId: parent.id });
          return false;
        }
      },
  
      memberCount: async (parent, args, context) => {
        console.log("memberCount Resolver")
        const { loaders } = context;
        try {
          return await loaders.communityMemberCountLoader.load(parent.id);
        } catch (error) {
          logger.error('Error loading member count', { error, communityId: parent.id });
          return parent.memberCount || 0;
        }
      }
    },
}

module.exports = resolvers