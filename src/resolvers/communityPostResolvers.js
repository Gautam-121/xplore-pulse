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
      try {
        return await communityPostService.createCommunityPost(input, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to Create community post', {
          extensions: { code: 'CREATE_POST_FAILED' }
        });
      }
    }),
    updateCommunityPost: requireAuth(async (_, { postId, input }, context) => {
      try {
        return await communityPostService.updateCommunityPost(postId, input, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to update community post', {
          extensions: { code: 'UPDATE_POST_FAILED' }
        });
      }
    }),
    deleteCommunityPost: requireAuth(async (_, { postId }, context) => {
      try {
        return await communityPostService.deleteCommunityPost(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to delete community post', {
          extensions: { code: 'DELETE_POST_FAILED' }
        });
      }
    }),
    reactToPost: requireAuth(async (parent, { postId, type }, context) => {
      try {
        return await postReactionService.reactToPost(postId, context.user.id, type);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to React community post', {
          extensions: { code: 'REACT_POST_FAILED' }
        });
      }
    }),
    unreactToPost: requireAuth(async (parent, { postId }, context) => {
      try {
        return await postReactionService.unreactToPost(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to UNREACT community post', {
          extensions: { code: 'UNREACT_POST_FAILED' }
        });
      }
    }),
    bookmarkPost: requireAuth(async (parent, { postId }, context) => {
      try {
        return await postBookmarkService.bookmarkPost(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to BookMark community post', {
          extensions: { code: 'BOOK_MARK_FAILED' }
        });
      }
    }),
    unbookmarkPost: requireAuth(async (parent, { postId }, context) => {
      try {
        return await postBookmarkService.unbookmarkPost(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to UnbookMark community post', {
          extensions: { code: 'UNBOOK_MARK_FAILED' }
        });
      }
    }),
    voteOnPoll: requireAuth(async (parent, { postId, optionId }, context) => {
      try {
        return await pollAnswerService.voteOnPoll(postId, optionId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to Vote on community poll post', {
          extensions: { code: 'VOTE_POLL_FAILED' }
        });
      }
    }),
    answerQuiz: requireAuth(async (parent, { postId, quizId, optionId }, context) => {
      try {
        return await quizResponseService.answerQuiz(postId, quizId, optionId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to answerQuiz on community quiz post', {
          extensions: { code: 'QUIZ_FAILED' }
        });
      }
    }),
    closePoll: requireAuth(async (_, { postId }, context) => {
      try {
        return await communityPostService.closePoll(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to close poll', {
          extensions: { code: 'CLOSE_POLL_FAILED' }
        });
      }
    }),
    closeQuiz: requireAuth(async (_, { postId }, context) => {
      try {
        return await communityPostService.closeQuiz(postId, context.user.id);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new GraphQLError(error?.message || 'Failed to close quiz', {
          extensions: { code: 'CLOSE_QUIZ_FAILED' }
        });
      }
    }),
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