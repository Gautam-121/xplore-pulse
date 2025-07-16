const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const PostReaction = db.PostReaction;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;
const communityService = require('./communityService');

const REACTION_TYPE_ENUM = ['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'];

const postReactionService = {
  async reactToPost(postId, userId, type) {
    // 1. Validate reaction type
    if (!type || !REACTION_TYPE_ENUM.includes(type)) {
      throw new GraphQLError('Invalid reaction type.', { extensions: { code: 'INVALID_REACTION_TYPE' } });
    }
    // 2. Validate post exists
    const post = await CommunityPost.findByPk(postId);
    if (!post) {
      throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
    }
    // 3. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to react.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 4. Upsert reaction (one per user per post)
    const transaction = await sequelize.transaction();
    try {
      await PostReaction.upsert({ postId, userId, type }, { transaction });
      await transaction.commit();
      // 5. Return aggregated reaction counts
      return await postReactionService.getReactionSummary(postId);
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async unreactToPost(postId, userId) {
    // 1. Validate post exists
    const post = await CommunityPost.findByPk(postId);
    if (!post) {
      throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
    }
    // 2. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to unreact.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Remove reaction
    await PostReaction.destroy({ where: { postId, userId } });
    // 4. Return updated reaction summary
    return await postReactionService.getReactionSummary(postId);
  },

  async getReactionSummary(postId) {
    // Aggregate counts by type
    const reactions = await PostReaction.findAll({
      where: { postId },
      attributes: ['type', [sequelize.fn('COUNT', sequelize.col('type')), 'count']],
      group: ['type']
    });
    // Format as array of { type, count }
    return reactions.map(r => ({ type: r.type, count: parseInt(r.get('count'), 10) }));
  }
};

module.exports = postReactionService; 