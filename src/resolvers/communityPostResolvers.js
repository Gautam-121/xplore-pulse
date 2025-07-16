const { requireAuth } = require('../middleware/auth');
const communityPostService = require('../services/communityPostService');
const postReactionService = require('../services/postReactionService');
const postBookmarkService = require('../services/postBookmarkService');
const postMentionService = require('../services/postMentionService');
const pollAnswerService = require('../services/pollAnswerService');
const quizResponseService = require('../services/quizResponseService');
const { GraphQLError } = require('graphql');

const resolvers = {
  Mutation: {
    createCommunityPost: requireAuth(async (parent, { input }, context) => {
      return await communityPostService.createCommunityPost(input, context.user.id);
    }),
    reactToPost: requireAuth(async (parent, { postId, type }, context) => {
      return await postReactionService.reactToPost(postId, context.user.id, type);
    }),
    unreactToPost: requireAuth(async (parent, { postId }, context) => {
      return await postReactionService.unreactToPost(postId, context.user.id);
    }),
    bookmarkPost: requireAuth(async (parent, { postId }, context) => {
      return await postBookmarkService.bookmarkPost(postId, context.user.id);
    }),
    unbookmarkPost: requireAuth(async (parent, { postId }, context) => {
      return await postBookmarkService.unbookmarkPost(postId, context.user.id);
    }),
    voteOnPoll: requireAuth(async (parent, { postId, optionId }, context) => {
      return await pollAnswerService.voteOnPoll(postId, optionId, context.user.id);
    }),
    answerQuiz: requireAuth(async (parent, { postId, quizId, optionId }, context) => {
      return await quizResponseService.answerQuiz(postId, quizId, optionId, context.user.id);
    })
  },
  Query: {
    getPollResults: requireAuth(async (parent, { postId }, context) => {
      return await pollAnswerService.getPollResults(postId);
    }),
    getQuizResults: requireAuth(async (parent, { postId, quizId }, context) => {
      return await quizResponseService.getQuizResults(postId, quizId);
    }),
    getMentions: requireAuth(async (parent, { postId }, context) => {
      return await postMentionService.getMentions(postId);
    })
    // Add more queries for fetching posts, reactions, bookmarks, etc.
  }
};

module.exports = resolvers; 