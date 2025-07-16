const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const PostBookmark = db.PostBookmark;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;
const communityService = require('./communityService');

const postBookmarkService = {
  async bookmarkPost(postId, userId) {
    // 1. Validate post exists
    const post = await CommunityPost.findByPk(postId);
    if (!post) {
      throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
    }
    // 2. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to bookmark.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Prevent duplicate bookmarks (unique index)
    try {
      await PostBookmark.create({ postId, userId });
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        // Already bookmarked, ignore
        return { success: true, message: 'Already bookmarked.' };
      }
      throw err;
    }
    return { success: true, message: 'Bookmarked.' };
  },

  async unbookmarkPost(postId, userId) {
    // 1. Validate post exists
    const post = await CommunityPost.findByPk(postId);
    if (!post) {
      throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
    }
    // 2. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to unbookmark.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Remove bookmark
    await PostBookmark.destroy({ where: { postId, userId } });
    return { success: true, message: 'Unbookmarked.' };
  },

  async isBookmarked(postId, userId) {
    // Returns true if the user has bookmarked the post
    const bookmark = await PostBookmark.findOne({ where: { postId, userId } });
    return !!bookmark;
  }
};

module.exports = postBookmarkService; 