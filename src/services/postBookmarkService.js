const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const PostBookmark = db.PostBookmark;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;

const postBookmarkService = {
  async bookmarkPost(postId, userId) {
    try {
      // 1. Validate post exists and is not soft-deleted
      const post = await CommunityPost.findByPk(postId, { paranoid: true });
      if (!post || post.deletedAt) {
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
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to bookmark post', { extensions: { code: 'BOOKMARK_POST_FAILED' } });
    }
  },

  async unbookmarkPost(postId, userId) {
    try {
      // 1. Validate post exists and is not soft-deleted
      const post = await CommunityPost.findByPk(postId, { paranoid: true });
      if (!post || post.deletedAt) {
        throw new GraphQLError('Post not found.', { extensions: { code: 'POST_NOT_FOUND' } });
      }
      // 2. Validate user is a member of the community
      const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
      if (!membership) {
        throw new GraphQLError('You must be a member of the community to unbookmark.', { extensions: { code: 'FORBIDDEN' } });
      }

      const postBookMark = await PostBookmark.findOne({ where: { postId, userId } })
      if(!postBookMark){
        throw new GraphQLError("Post Book-Mark not found",{
          extensions: { code: "BOOKMARK_NOT_FOUND"}
        })
      }
      // 3. Remove bookmark (idempotent)
      await postBookMark.destroy();
      return { success: true, message: 'Unbookmarked.' };
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to unbookmark post', { extensions: { code: 'UNBOOKMARK_POST_FAILED' } });
    }
  },

  async isBookmarked(postId, userId) {
    const bookmark = await PostBookmark.findOne({ where: { postId, userId } });
    return !!bookmark;
  }
};

module.exports = postBookmarkService; 