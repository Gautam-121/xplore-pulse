const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const PostReaction = db.PostReaction;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const REACTION_TYPE_ENUM = ['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY'];

async function getReactionSummary(postId) {
  const reactions = await PostReaction.findAll({ where: { postId } });
  const summary = {};
  REACTION_TYPE_ENUM.forEach(type => summary[type] = 0);
  reactions.forEach(r => { summary[r.type] = (summary[r.type] || 0) + 1; });
  return Object.entries(summary).map(([type, count]) => ({ type, count }));
}

const postReactionService = {
  async reactToPost(postId, userId, type) {
    try {
      // 1. Validate reaction type
      if (!REACTION_TYPE_ENUM.includes(type)) {
        throw new GraphQLError('Invalid reaction type.', { extensions: { code: 'INVALID_REACTION_TYPE' } });
      }
      // 2. Validate post exists and is not deleted
      const post = await CommunityPost.findByPk(postId, { paranoid: true });
      if (!post || post.deletedAt) {
        throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
      }
      // 3. Validate user is a member of the community
      const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
      if (!membership) {
        throw new GraphQLError('You must be a member of the community to react.', { extensions: { code: 'FORBIDDEN' } });
      }
      // 4. Upsert reaction (one per user per post)
      await PostReaction.upsert({ postId, userId, type });
      // 5. Return aggregated reaction counts
      return await getReactionSummary(postId);
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to react to post', { extensions: { code: 'REACT_POST_FAILED' } });
    }
  },
  async unreactToPost(postId, userId) {
    try {
      // 1. Validate post exists and is not deleted
      const post = await CommunityPost.findByPk(postId, { paranoid: true });
      if (!post || post.deletedAt) {
        throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
      }
      // 2. Validate user is a member of the community
      const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
      if (!membership) {
        throw new GraphQLError('You must be a member of the community to unreact.', { extensions: { code: 'FORBIDDEN' } });
      }

      const postReaction = await PostReaction.findOne({ where: { postId , userId }})
      if(!postReaction){
        throw new GraphQLError("No reaction found",{
          extensions: { code: "REACTION_NOT_FOUND"}
        })
      }
      // 3. Remove reaction
      await postReaction.destroy();
      // 4. Return aggregated reaction counts
      return await getReactionSummary(postId);
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to unreact to post', { extensions: { code: 'UNREACT_POST_FAILED' } });
    }
  }
};

module.exports = postReactionService; 