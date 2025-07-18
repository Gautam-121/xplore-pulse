const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const PollAnswer = db.PollAnswer;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;

const pollAnswerService = {
  async voteOnPoll(postId, optionId, userId) {
    // 1. Validate post exists, is a poll, and not soft-deleted
    const post = await CommunityPost.findByPk(postId, { paranoid: false });
    if (!post || post.type !== 'POLL') {
      throw new GraphQLError('Poll post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    if (post.deletedAt) {
      throw new GraphQLError('This poll post has been deleted.', { extensions: { code: 'POST_DELETED' } });
    }
    // 2. Check poll open/close status and close time
    if (post.pollOpen === false) {
      throw new GraphQLError('This poll is closed for voting.', { extensions: { code: 'POLL_CLOSED' } });
    }
    if (post.pollCloseAt && new Date(post.pollCloseAt) <= new Date()) {
      throw new GraphQLError('This poll has expired and is closed for voting.', { extensions: { code: 'POLL_EXPIRED' } });
    }
    // 2. Validate user is a member and not banned
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId } });
    if (!membership || membership.status !== 'APPROVED') {
      if (membership && membership.status === 'BANNED') {
        throw new GraphQLError('You are banned from this community and cannot vote.', { extensions: { code: 'BANNED' } });
      }
      throw new GraphQLError('You must be an approved member of the community to vote.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Validate pollOptions is a non-empty array
    const pollOptions = Array.isArray(post.pollOptions) ? post.pollOptions : [];
    if (!pollOptions.length) {
      throw new GraphQLError('This poll has no options to vote on.', { extensions: { code: 'NO_OPTIONS' } });
    }
    // 4. Validate optionId is present and valid
    if (!optionId || typeof optionId !== 'string') {
      throw new GraphQLError('A valid poll optionId must be provided.', { extensions: { code: 'INVALID_OPTION_ID' } });
    }
    const option = pollOptions.find(opt => opt.id === optionId);
    if (!option) {
      throw new GraphQLError('Invalid poll option.', { extensions: { code: 'INVALID_OPTION' } });
    }
    // 5. Prevent duplicate votes (unique index)
    const existing = await PollAnswer.findOne({ where: { postId, userId } });
    if (existing) {
      throw new GraphQLError('You have already voted on this poll.', { extensions: { code: 'ALREADY_VOTED' } });
    }
    // 6. Transaction for atomicity
    const transaction = await sequelize.transaction();
    try {
      // 7. Insert poll answer
      await PollAnswer.create({ postId, optionId, userId }, { transaction });
      // 8. Increment pollCount in CommunityPost
      post.pollCount = (post.pollCount || 0) + 1;
      // 9. Increment voteCount in pollOptions (denormalized for fast reads)
      const updatedOptions = pollOptions.map(opt =>
        opt.id === optionId ? { ...opt, voteCount: (opt.voteCount || 0) + 1 } : opt
      );
      post.pollOptions = updatedOptions;
      await post.save({ transaction });
      await transaction.commit();
      // 10. Return updated poll results
      return await pollAnswerService.getPollResults(postId);
    } catch (err) {
      await transaction.rollback();
      throw new GraphQLError(err.message || 'Failed to vote on poll.', { extensions: { code: 'VOTE_POLL_FAILED' } });
    }
  },

  async getPollResults(postId) {
    // Aggregate votes per option
    const post = await CommunityPost.findByPk(postId);
    if (!post || post.type !== 'POLL') {
      throw new GraphQLError('Poll post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    const pollOptions = Array.isArray(post.pollOptions) ? post.pollOptions : [];
    // Get vote counts from PollAnswer table
    const answers = await PollAnswer.findAll({ where: { postId } });
    const counts = {};
    answers.forEach(a => {
      counts[a.optionId] = (counts[a.optionId] || 0) + 1;
    });
    // Return poll options with up-to-date vote counts
    return pollOptions.map(opt => ({
      id: opt.id,
      text: opt.text,
      voteCount: counts[opt.id] || 0
    }));
  }
};

module.exports = pollAnswerService; 