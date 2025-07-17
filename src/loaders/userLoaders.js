const DataLoader = require('dataloader');
const db = require("../config/dbConfig");
const User = db.User;
const Community = db.Community;
const CommunityMember = db.CommunityMember;
const CommunityPost = db.CommunityPost;
const PostLike = db.PostLike;
const PostBookmark = db.PostBookmark;
const EventRegistration = db.EventRegistration;
const Interest = db.Interest;
const { Op } = require("sequelize");
const logger = require('../utils/logger');

// Performance monitoring utility
const performanceMonitor = require('../utils/performance');

const createUserLoaders = () => {
    // User DataLoader
    const userLoader = new DataLoader(async (userIds) => {
        try {
            // performanceMonitor.startTimer('userLoader');
            
            const users = await User.findAll({
                where: { id: { [Op.in]: userIds } },
                attributes: ['id', 'name', 'email', 'profileImageUrl', 'bio', 'isActive', 'createdAt']
            });

            const userMap = new Map();
            users.forEach(user => userMap.set(user.id, user));

            const result = userIds.map(id => userMap.get(id) || null);
            
            // performanceMonitor.endTimer('userLoader', { batchSize: userIds.length, foundCount: users.length });
            return result;
        } catch (error) {
            logger.error('Error in userLoader', { error, userIds });
            throw error;
        }
    });

    // User by Email DataLoader
    const userByEmailLoader = new DataLoader(async (emails) => {
        try {
            // performanceMonitor.startTimer('userByEmailLoader');
            
            const users = await User.findAll({
                where: { email: { [Op.in]: emails } },
                attributes: ['id', 'name', 'email', 'profileImageUrl', 'bio', 'isActive', 'createdAt']
            });

            const userMap = new Map();
            users.forEach(user => userMap.set(user.email, user));

            const result = emails.map(email => userMap.get(email) || null);
            
            // performanceMonitor.endTimer('userByEmailLoader', { batchSize: emails.length, foundCount: users.length });
            return result;
        } catch (error) {
            logger.error('Error in userByEmailLoader', { error, emails });
            throw error;
        }
    });

    // User Interests DataLoader
    const userInterestsLoader = new DataLoader(async (userIds) => {
        try {
            // performanceMonitor.startTimer('userInterestsLoader');
            
            const userInterests = await User.findAll({
                where: { id: { [Op.in]: userIds } },
                include: [{
                    model: Interest,
                    as: 'interests',
                    attributes: ['id', 'name', 'category', 'icon'],
                    through: { attributes: [] }
                }],
                attributes: ['id']
            });

            const result = userIds.map(userId => {
                const user = userInterests.find(u => u.id === userId);
                return user ? user.interests : [];
            });
            
            // performanceMonitor.endTimer('userInterestsLoader', { batchSize: userIds.length });
            return result;
        } catch (error) {
            logger.error('Error in userInterestsLoader', { error, userIds });
            throw error;
        }
    });

    // User Communities DataLoader
    const userCommunitiesLoader = new DataLoader(async (userIds) => {
        try {
            // performanceMonitor.startTimer('userCommunitiesLoader');
            
            const userCommunities = await CommunityMember.findAll({
                where: { userId: { [Op.in]: userIds } },
                include: [{
                    model: Community,
                    as: 'community',
                    attributes: ['id', 'name', 'slug', 'imageUrl', 'memberCount', 'isPrivate'],
                    include: [{
                        model: User,
                        as: 'owner',
                        attributes: ['id', 'name', 'profileImageUrl']
                    }]
                }],
                attributes: ['userId', 'communityId', 'role', 'status', 'joinedAt']
            });

            const result = userIds.map(userId => {
                return userCommunities
                    .filter(membership => membership.userId === userId)
                    .map(membership => membership.community);
            });
            
            // performanceMonitor.endTimer('userCommunitiesLoader', { batchSize: userIds.length });
            return result;
        } catch (error) {
            logger.error('Error in userCommunitiesLoader', { error, userIds });
            throw error;
        }
    });

    // User Owned Communities DataLoader
    const userOwnedCommunitiesLoader = new DataLoader(async (userIds) => {
        try {
            // performanceMonitor.startTimer('userOwnedCommunitiesLoader');
            
            const ownedCommunities = await Community.findAll({
                where: { ownerId: { [Op.in]: userIds } },
                include: [{
                    model: User,
                    as: 'owner',
                    attributes: ['id', 'name', 'profileImageUrl']
                }],
                attributes: ['id', 'name', 'slug', 'imageUrl', 'memberCount', 'isPrivate', 'ownerId']
            });

            const result = userIds.map(userId => {
                return ownedCommunities.filter(community => community.ownerId === userId);
            });
            
            // performanceMonitor.endTimer('userOwnedCommunitiesLoader', { batchSize: userIds.length });
            return result;
        } catch (error) {
            logger.error('Error in userOwnedCommunitiesLoader', { error, userIds });
            throw error;
        }
    });

    // Community Members DataLoader
    const communityMembersLoader = new DataLoader(async (communityIds) => {
        try {
            // performanceMonitor.startTimer('communityMembersLoader');
            
            const members = await CommunityMember.findAll({
                where: { communityId: { [Op.in]: communityIds } },
                include: [{
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'profileImageUrl', 'bio']
                }],
                attributes: ['communityId', 'userId', 'role', 'status', 'joinedAt']
            });

            const result = communityIds.map(communityId => {
                return members.filter(member => member.communityId === communityId);
            });
            
            // performanceMonitor.endTimer('communityMembersLoader', { batchSize: communityIds.length });
            return result;
        } catch (error) {
            logger.error('Error in communityMembersLoader', { error, communityIds });
            throw error;
        }
    });

    // Community Member Count DataLoader
    const communityMemberCountLoader = new DataLoader(async (communityIds) => {
        try {
            // performanceMonitor.startTimer('communityMemberCountLoader');
            
            const memberCounts = await CommunityMember.findAll({
                where: { 
                    communityId: { [Op.in]: communityIds },
                    status: 'APPROVED'
                },
                attributes: [
                    'communityId',
                    [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']
                ],
                group: ['communityId'],
                raw: true
            });

            const countMap = new Map();
            memberCounts.forEach(item => {
                countMap.set(item.communityId, parseInt(item.count));
            });

            const result = communityIds.map(communityId => countMap.get(communityId) || 0);
            
            // performanceMonitor.endTimer('communityMemberCountLoader', { batchSize: communityIds.length });
            return result;
        } catch (error) {
            logger.error('Error in communityMemberCountLoader', { error, communityIds });
            throw error;
        }
    });

    // Community Owner DataLoader
    const communityOwnerLoader = new DataLoader(async (communityIds) => {
        try {
            // performanceMonitor.startTimer('communityOwnerLoader');
            
            const communities = await Community.findAll({
                where: { id: { [Op.in]: communityIds } },
                include: [{
                    model: User,
                    as: 'owner',
                    attributes: ['id', 'name', 'profileImageUrl', 'bio']
                }],
                attributes: ['id', 'ownerId']
            });

            const result = communityIds.map(communityId => {
                const community = communities.find(c => c.id === communityId);
                return community ? community.owner : null;
            });
            
            // performanceMonitor.endTimer('communityOwnerLoader', { batchSize: communityIds.length });
            return result;
        } catch (error) {
            logger.error('Error in communityOwnerLoader', { error, communityIds });
            throw error;
        }
    });

    // Community Interests DataLoader
    const communityInterestsLoader = new DataLoader(async (communityIds) => {
        try {
            // performanceMonitor.startTimer('communityInterestsLoader');
            
            const communities = await Community.findAll({
                where: { id: { [Op.in]: communityIds } },
                include: [{
                    model: Interest,
                    as: 'interests',
                    attributes: ['id', 'name', 'category', 'icon'],
                    through: { attributes: [] }
                }],
                attributes: ['id']
            });

            const result = communityIds.map(communityId => {
                const community = communities.find(c => c.id === communityId);
                return community ? community.interests : [];
            });
            
            // performanceMonitor.endTimer('communityInterestsLoader', { batchSize: communityIds.length });
            return result;
        } catch (error) {
            logger.error('Error in communityInterestsLoader', { error, communityIds });
            throw error;
        }
    });

    // Post Likes DataLoader
    const postLikesLoader = new DataLoader(async (postIds) => {
        try {
            // performanceMonitor.startTimer('postLikesLoader');
            
            const likes = await PostLike.findAll({
                where: { postId: { [Op.in]: postIds } },
                include: [{
                    model: User,
                    attributes: ['id', 'name', 'profileImageUrl']
                }],
                attributes: ['postId', 'userId', 'createdAt']
            });

            const result = postIds.map(postId => {
                return likes.filter(like => like.postId === postId);
            });
            
            // performanceMonitor.endTimer('postLikesLoader', { batchSize: postIds.length });
            return result;
        } catch (error) {
            logger.error('Error in postLikesLoader', { error, postIds });
            throw error;
        }
    });

    // Post Like Count DataLoader
    const postLikeCountLoader = new DataLoader(async (postIds) => {
        try {
            // performanceMonitor.startTimer('postLikeCountLoader');
            
            const likeCounts = await PostLike.findAll({
                where: { postId: { [Op.in]: postIds } },
                attributes: [
                    'postId',
                    [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']
                ],
                group: ['postId'],
                raw: true
            });

            const countMap = new Map();
            likeCounts.forEach(item => {
                countMap.set(item.postId, parseInt(item.count));
            });

            const result = postIds.map(postId => countMap.get(postId) || 0);
            
            // performanceMonitor.endTimer('postLikeCountLoader', { batchSize: postIds.length });
            return result;
        } catch (error) {
            logger.error('Error in postLikeCountLoader', { error, postIds });
            throw error;
        }
    });

    // Post Bookmarks DataLoader
    const postBookmarksLoader = new DataLoader(async (postIds) => {
        try {
            // performanceMonitor.startTimer('postBookmarksLoader');
            
            const bookmarks = await PostBookmark.findAll({
                where: { postId: { [Op.in]: postIds } },
                include: [{
                    model: User,
                    attributes: ['id', 'name', 'profileImageUrl']
                }],
                attributes: ['postId', 'userId', 'createdAt']
            });

            const result = postIds.map(postId => {
                return bookmarks.filter(bookmark => bookmark.postId === postId);
            });
            
            // performanceMonitor.endTimer('postBookmarksLoader', { batchSize: postIds.length });
            return result;
        } catch (error) {
            logger.error('Error in postBookmarksLoader', { error, postIds });
            throw error;
        }
    });

    // Event Registrations DataLoader
    const eventRegistrationsLoader = new DataLoader(async (postIds) => {
        try {
            // performanceMonitor.startTimer('eventRegistrationsLoader');
            
            const registrations = await EventRegistration.findAll({
                where: { postId: { [Op.in]: postIds } },
                include: [{
                    model: User,
                    attributes: ['id', 'name', 'profileImageUrl']
                }],
                attributes: ['postId', 'userId', 'paymentStatus', 'ticketCode', 'createdAt']
            });

            const result = postIds.map(postId => {
                return registrations.filter(registration => registration.postId === postId);
            });
            
            // performanceMonitor.endTimer('eventRegistrationsLoader', { batchSize: postIds.length });
            return result;
        } catch (error) {
            logger.error('Error in eventRegistrationsLoader', { error, postIds });
            throw error;
        }
    });

    // User Membership Status DataLoader
    const userMembershipStatusLoader = new DataLoader(async (keys) => {
        try {
            // performanceMonitor.startTimer('userMembershipStatusLoader');
            
            const [communityIds, userIds] = keys.reduce((acc, key) => {
                acc[0].push(key.communityId);
                acc[1].push(key.userId);
                return acc;
            }, [[], []]);

            const memberships = await CommunityMember.findAll({
                where: {
                    communityId: { [Op.in]: communityIds },
                    userId: { [Op.in]: userIds }
                },
                attributes: ['communityId', 'userId', 'status', 'role']
            });

            const result = keys.map(key => {
                const membership = memberships.find(m => 
                    m.communityId === key.communityId && m.userId === key.userId
                );
                return membership ? membership.status : 'NOT_MEMBER';
            });

            console.log("UserMember" , result)
            
            // performanceMonitor.endTimer('userMembershipStatusLoader', { batchSize: keys.length });
            return result;
        } catch (error) {
            logger.error('Error in userMembershipStatusLoader', { error, keys });
            throw error;
        }
    });

    return {
        userLoader,
        userByEmailLoader,
        userInterestsLoader,
        userCommunitiesLoader,
        userOwnedCommunitiesLoader,
        communityMembersLoader,
        communityMemberCountLoader,
        communityOwnerLoader,
        communityInterestsLoader,
        postLikesLoader,
        postLikeCountLoader,
        postBookmarksLoader,
        eventRegistrationsLoader,
        userMembershipStatusLoader
    };
};

module.exports = createUserLoaders;
