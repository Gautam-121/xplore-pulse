const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const QuizResponse = db.QuizResponse;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;

const quizResponseService = {
  async answerQuiz(postId, quizId, optionId, userId) {
    // 1. Validate post exists, contains quizzes, and is not soft-deleted
    const post = await CommunityPost.findByPk(postId, { paranoid: false });
    if (!post || !Array.isArray(post.quizzes)) {
      throw new GraphQLError('Quiz post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    if (post.deletedAt) {
      throw new GraphQLError('This quiz post has been deleted.', { extensions: { code: 'POST_DELETED' } });
    }
    // 2. Check quiz open/close status and close time
    if (post.quizOpen === false) {
      throw new GraphQLError('This quiz is closed for answering.', { extensions: { code: 'QUIZ_CLOSED' } });
    }
    if (post.quizCloseAt && new Date(post.quizCloseAt) <= new Date()) {
      throw new GraphQLError('This quiz has expired and is closed for answering.', { extensions: { code: 'QUIZ_EXPIRED' } });
    }
    // 2. Validate user is a member and not banned
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId } });
    if (!membership || membership.status !== 'APPROVED') {
      if (membership && membership.status === 'BANNED') {
        throw new GraphQLError('You are banned from this community and cannot answer quizzes.', { extensions: { code: 'BANNED' } });
      }
      throw new GraphQLError('You must be an approved member of the community to answer quizzes.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Validate quizzes is a non-empty array
    if (!post.quizzes.length) {
      throw new GraphQLError('This post has no quizzes to answer.', { extensions: { code: 'NO_QUIZZES' } });
    }
    // 4. Validate quizId and optionId are present and valid
    if (!quizId || typeof quizId !== 'string') {
      throw new GraphQLError('A valid quizId must be provided.', { extensions: { code: 'INVALID_QUIZ_ID' } });
    }
    if (!optionId || typeof optionId !== 'string') {
      throw new GraphQLError('A valid quiz optionId must be provided.', { extensions: { code: 'INVALID_OPTION_ID' } });
    }
    const quiz = post.quizzes.find(q => q.id === quizId);
    if (!quiz) {
      throw new GraphQLError('Quiz not found in this post.', { extensions: { code: 'QUIZ_NOT_FOUND' } });
    }
    if (!Array.isArray(quiz.options) || !quiz.options.length) {
      throw new GraphQLError('This quiz has no options to answer.', { extensions: { code: 'NO_OPTIONS' } });
    }
    const option = quiz.options.find(opt => opt.id === optionId);
    if (!option) {
      throw new GraphQLError('Invalid quiz option.', { extensions: { code: 'INVALID_OPTION' } });
    }
    // 5. Prevent duplicate answers (unique per user per quiz per post)
    const existing = await QuizResponse.findOne({ where: { postId, quizId, userId } });
    if (existing) {
      throw new GraphQLError('You have already answered this quiz.', { extensions: { code: 'ALREADY_ANSWERED' } });
    }
    // 6. Transaction for atomicity
    const transaction = await sequelize.transaction();
    try {
      // 7. Insert quiz response
      await QuizResponse.create({ postId, quizId, userId, optionId }, { transaction });
      await transaction.commit();
      // 8. Return user's answer and correct answer (if allowed)
      return {
        quizId,
        userId,
        optionId,
        correctOptionId: quiz.correctOptionId || null
      };
    } catch (err) {
      await transaction.rollback();
      throw new GraphQLError(err.message || 'Failed to answer quiz.', { extensions: { code: 'QUIZ_FAILED' } });
    }
  },

  async getQuizResults(postId, quizId) {
    // Aggregate answers for a quiz in a post
    const post = await CommunityPost.findByPk(postId);
    if (!post || !Array.isArray(post.quizzes)) {
      throw new GraphQLError('Quiz post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    const quiz = post.quizzes.find(q => q.id === quizId);
    if (!quiz) {
      throw new GraphQLError('Quiz not found in this post.', { extensions: { code: 'QUIZ_NOT_FOUND' } });
    }
    // Get all responses
    const responses = await QuizResponse.findAll({ where: { postId, quizId } });
    const counts = {};
    responses.forEach(r => {
      counts[r.optionId] = (counts[r.optionId] || 0) + 1;
    });
    // Return quiz options with up-to-date answer counts
    return quiz.options.map(opt => ({
      id: opt.id,
      text: opt.text,
      answerCount: counts[opt.id] || 0
    }));
  }
};

module.exports = quizResponseService; 