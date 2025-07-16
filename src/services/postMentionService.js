const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const PostMention = db.PostMention;
const User = db.User;

const postMentionService = {
  async addMentions(postId, userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) return;
    // Validate all users exist
    const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
    if (users.length !== userIds.length) {
      throw new GraphQLError('One or more mentioned users do not exist.', { extensions: { code: 'INVALID_MENTION' } });
    }
    // Bulk insert mentions, ignore duplicates
    await PostMention.bulkCreate(
      userIds.map(uid => ({ postId, userId: uid })),
      { ignoreDuplicates: true }
    );
  },

  async getMentions(postId) {
    // Fetch all mentioned users for a post
    const mentions = await PostMention.findAll({ where: { postId } });
    const userIds = mentions.map(m => m.userId);
    if (userIds.length === 0) return [];
    // Fetch user details
    const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
    return users;
  }
};

module.exports = postMentionService; 