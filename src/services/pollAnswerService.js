const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const PollAnswer = db.PollAnswer;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;

const pollAnswerService = {
  async voteOnPoll(postId, optionId, userId) {
    // 1. Validate post exists and is a poll
    const post = await CommunityPost.findByPk(postId);
    if (!post || post.type !== 'POLL') {
      throw new GraphQLError('Poll post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    // 2. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to vote.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Validate optionId is valid for the poll
    const pollOptions = Array.isArray(post.pollOptions) ? post.pollOptions : [];
    const option = pollOptions.find(opt => opt.id === optionId);
    if (!option) {
      throw new GraphQLError('Invalid poll option.', { extensions: { code: 'INVALID_OPTION' } });
    }
    // 4. Prevent duplicate votes (unique index)
    const existing = await PollAnswer.findOne({ where: { postId, userId } });
    if (existing) {
      throw new GraphQLError('You have already voted on this poll.', { extensions: { code: 'ALREADY_VOTED' } });
    }
    // 5. Transaction for atomicity
    const transaction = await sequelize.transaction();
    try {
      // 6. Insert poll answer
      await PollAnswer.create({ postId, optionId, userId }, { transaction });
      // 7. Increment pollCount in CommunityPost
      post.pollCount = (post.pollCount || 0) + 1;
      // 8. Increment voteCount in pollOptions (denormalized for fast reads)
      const updatedOptions = pollOptions.map(opt =>
        opt.id === optionId ? { ...opt, voteCount: (opt.voteCount || 0) + 1 } : opt
      );
      post.pollOptions = updatedOptions;
      await post.save({ transaction });
      await transaction.commit();
      // 9. Return updated poll results
      return await pollAnswerService.getPollResults(postId);
    } catch (err) {
      await transaction.rollback();
      throw err;
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