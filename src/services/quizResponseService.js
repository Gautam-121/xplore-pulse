const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const QuizResponse = db.QuizResponse;
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const sequelize = db.sequelize;

const quizResponseService = {
  async answerQuiz(postId, quizId, optionId, userId) {
    // 1. Validate post exists and contains the quiz
    const post = await CommunityPost.findByPk(postId);
    if (!post || !Array.isArray(post.quizzes)) {
      throw new GraphQLError('Quiz post not found.', { extensions: { code: 'NOT_FOUND' } });
    }
    // 2. Validate user is a member of the community
    const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId, status: 'APPROVED' } });
    if (!membership) {
      throw new GraphQLError('You must be a member of the community to answer quizzes.', { extensions: { code: 'FORBIDDEN' } });
    }
    // 3. Validate quizId and optionId
    const quiz = post.quizzes.find(q => q.id === quizId);
    if (!quiz) {
      throw new GraphQLError('Quiz not found in this post.', { extensions: { code: 'QUIZ_NOT_FOUND' } });
    }
    const option = quiz.options.find(opt => opt.id === optionId);
    if (!option) {
      throw new GraphQLError('Invalid quiz option.', { extensions: { code: 'INVALID_OPTION' } });
    }
    // 4. Prevent duplicate answers (unique per user per quiz per post)
    const existing = await QuizResponse.findOne({ where: { postId, quizId, userId } });
    if (existing) {
      throw new GraphQLError('You have already answered this quiz.', { extensions: { code: 'ALREADY_ANSWERED' } });
    }
    // 5. Transaction for atomicity
    const transaction = await sequelize.transaction();
    try {
      // 6. Insert quiz response
      await QuizResponse.create({ postId, quizId, userId, optionId }, { transaction });
      await transaction.commit();
      // 7. Return user's answer and correct answer (if allowed)
      return {
        quizId,
        userId,
        optionId,
        correctOptionId: quiz.correctOptionId || null
      };
    } catch (err) {
      await transaction.rollback();
      throw err;
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