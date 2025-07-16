const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const PostMention = db.PostMention;
const User = db.User;
const sequelize = db.sequelize;
const communityService = require('./communityService');

// Helper: Validate URL (simple robust regex)
function isValidUrl(url) {
  const urlRegex = /^(https?:\/\/)[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\]@!$&'()*+,;=.]+$/i;
  return typeof url === 'string' && urlRegex.test(url);
}

const POST_TYPE_ENUM = ['TEXT', 'IMAGE', 'VIDEO', 'LINK', 'POLL', 'EDUCATIONAL', 'QUIZ', 'MIXED'];
const MEDIA_TYPE_ENUM = ['IMAGE', 'VIDEO'];
const VISIBILITY_ENUM = ['PUBLIC', 'MEMBERS_ONLY', 'ADMINS_ONLY', 'PRIVATE'];

const TITLE_MIN = 2, TITLE_MAX = 200;
const CONTENT_MIN = 0, CONTENT_MAX = 5000;
const TAGS_MAX = 10, TAG_MAX_LEN = 32;

const communityPostService = {
  async createCommunityPost(input, userId) {
    const {
      communityId, type, title, content, media, linkUrl, linkTitle, linkDescription, linkImageUrl,
      quizzes, pollOptions, tags, mentions, visibility, isSponsored
    } = input;

    // 1. Validate user is OWNER/ADMIN/MODERATOR
    const membership = await CommunityMember.findOne({ where: { communityId, userId, status: 'APPROVED' } });
    if (!membership || !['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role)) {
      throw new GraphQLError('Only community owner, admin, or moderator can post.', { extensions: { code: 'FORBIDDEN' } });
    }

    // 2. Validate type
    if (!type || !POST_TYPE_ENUM.includes(type)) {
      throw new GraphQLError('Invalid or missing post type.', { extensions: { code: 'INVALID_TYPE' } });
    }

    // 3. Validate title
    if (!title || typeof title !== 'string' || title.length < TITLE_MIN || title.length > TITLE_MAX) {
      throw new GraphQLError(`Title must be ${TITLE_MIN}-${TITLE_MAX} characters.`, { extensions: { code: 'INVALID_TITLE' } });
    }

    // 4. Validate content
    if (content && (typeof content !== 'string' || content.length < CONTENT_MIN || content.length > CONTENT_MAX)) {
      throw new GraphQLError(`Content must be ${CONTENT_MIN}-${CONTENT_MAX} characters.`, { extensions: { code: 'INVALID_CONTENT' } });
    }

    // 5. Validate tags
    if (tags) {
      if (!Array.isArray(tags)) throw new GraphQLError('Tags must be an array.', { extensions: { code: 'INVALID_TAGS' } });
      if (tags.length > TAGS_MAX) throw new GraphQLError(`A post can have at most ${TAGS_MAX} tags.`, { extensions: { code: 'TOO_MANY_TAGS' } });
      tags.forEach((tag, idx) => {
        if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > TAG_MAX_LEN) {
          throw new GraphQLError(`Tag at index ${idx} is invalid or too long (max ${TAG_MAX_LEN}).`, { extensions: { code: 'INVALID_TAG' } });
        }
      });
    }

    // 6. Validate media
    if (['IMAGE', 'VIDEO', 'MIXED'].includes(type)) {
      if (!Array.isArray(media) || media.length === 0) {
        throw new GraphQLError('Media array is required for image, video, or mixed posts.', { extensions: { code: 'MEDIA_REQUIRED' } });
      }
      if (media.length > 10) throw new GraphQLError('A post can have at most 10 media items.', { extensions: { code: 'MEDIA_LIMIT_EXCEEDED' } });
      media.forEach((item, idx) => {
        if (!item.type || !MEDIA_TYPE_ENUM.includes(item.type)) {
          throw new GraphQLError(`Invalid media type at index ${idx}.`, { extensions: { code: 'INVALID_MEDIA_TYPE' } });
        }
        if (!item.url || !isValidUrl(item.url)) {
          throw new GraphQLError(`Invalid or missing url for media at index ${idx}.`, { extensions: { code: 'INVALID_MEDIA_URL' } });
        }
        if (item.thumbnailUrl && !isValidUrl(item.thumbnailUrl)) {
          throw new GraphQLError(`Invalid thumbnailUrl for media at index ${idx}.`, { extensions: { code: 'INVALID_THUMBNAIL_URL' } });
        }
        if (item.altText && typeof item.altText !== 'string') {
          throw new GraphQLError(`altText for media at index ${idx} must be a string.`, { extensions: { code: 'INVALID_ALT_TEXT' } });
        }
      });
    } else {
      // For non-media posts, media must be an array (can be empty)
      if (media && !Array.isArray(media)) {
        throw new GraphQLError('Media must be an array.', { extensions: { code: 'INVALID_MEDIA' } });
      }
    }

    // 7. Validate link fields if type is LINK or if any link field is present
    if (type === 'LINK' || linkUrl || linkTitle || linkDescription || linkImageUrl) {
      if (!linkUrl || !isValidUrl(linkUrl)) {
        throw new GraphQLError('A valid linkUrl is required for link posts.', { extensions: { code: 'INVALID_LINK_URL' } });
      }
      if (linkTitle && (typeof linkTitle !== 'string' || linkTitle.length > 200)) {
        throw new GraphQLError('linkTitle must be a string up to 200 characters.', { extensions: { code: 'INVALID_LINK_TITLE' } });
      }
      if (linkDescription && (typeof linkDescription !== 'string' || linkDescription.length > 1000)) {
        throw new GraphQLError('linkDescription must be a string up to 1000 characters.', { extensions: { code: 'INVALID_LINK_DESCRIPTION' } });
      }
      if (linkImageUrl && !isValidUrl(linkImageUrl)) {
        throw new GraphQLError('linkImageUrl must be a valid URL.', { extensions: { code: 'INVALID_LINK_IMAGE_URL' } });
      }
    }

    // 8. Validate quizzes
    let quizzesData = [];
    if (type === 'QUIZ') {
      if (!Array.isArray(quizzes) || quizzes.length === 0) throw new GraphQLError('At least one quiz is required.', { extensions: { code: 'INVALID_QUIZ' } });
      quizzes.forEach((quiz, idx) => {
        if (!quiz.question || typeof quiz.question !== 'string' || quiz.question.length < 2 || quiz.question.length > 500) {
          throw new GraphQLError(`Quiz question at index ${idx} must be 2-500 characters.`, { extensions: { code: 'INVALID_QUIZ_QUESTION' } });
        }
        if (!Array.isArray(quiz.options) || quiz.options.length < 2) {
          throw new GraphQLError(`Quiz at index ${idx} must have at least 2 options.`, { extensions: { code: 'INVALID_QUIZ_OPTIONS' } });
        }
        quiz.options.forEach((opt, oidx) => {
          if (!opt.text || typeof opt.text !== 'string' || opt.text.length < 1 || opt.text.length > 200) {
            throw new GraphQLError(`Quiz option at quiz ${idx}, option ${oidx} must be 1-200 characters.`, { extensions: { code: 'INVALID_QUIZ_OPTION' } });
          }
        });
      });
      quizzesData = quizzes;
    }

    // 9. Validate poll options
    let pollOptionsData = [];
    if (type === 'POLL') {
      if (!Array.isArray(pollOptions) || pollOptions.length < 2) throw new GraphQLError('Poll must have at least 2 options.', { extensions: { code: 'INVALID_POLL_OPTIONS' } });
      pollOptionsData = pollOptions.map(opt => {
        if (!opt.text || typeof opt.text !== 'string' || opt.text.length < 1 || opt.text.length > 200) {
          throw new GraphQLError('Each poll option must be 1-200 characters.', { extensions: { code: 'INVALID_POLL_OPTION' } });
        }
        return {
          id: require('crypto').randomUUID(),
          text: opt.text,
          voteCount: 0
        };
      });
    }

    // 10. Validate mentions
    let mentionUserIds = [];
    if (Array.isArray(mentions) && mentions.length > 0) {
      const users = await User.findAll({ where: { id: { [Op.in]: mentions } } });
      if (users.length !== mentions.length) {
        throw new GraphQLError('One or more mentioned users do not exist.', { extensions: { code: 'INVALID_MENTION' } });
      }
      mentionUserIds = mentions;
    }

    // 11. Validate visibility
    if (visibility && !VISIBILITY_ENUM.includes(visibility)) {
      throw new GraphQLError('Invalid visibility value.', { extensions: { code: 'INVALID_VISIBILITY' } });
    }

    // 12. Transaction for atomicity
    const transaction = await sequelize.transaction();
    try {
      // 13. Create the post
      const post = await CommunityPost.create({
        communityId,
        authorId: userId,
        type,
        title,
        content,
        media,
        linkUrl,
        linkTitle,
        linkDescription,
        linkImageUrl,
        quizzes: quizzesData,
        pollOptions: pollOptionsData,
        pollCount: 0,
        tags,
        visibility: visibility || 'PUBLIC',
        isSponsored: !!isSponsored
      }, { transaction });

      // 14. Insert mentions
      if (mentionUserIds.length > 0) {
        await PostMention.bulkCreate(
          mentionUserIds.map(uid => ({ postId: post.id, userId: uid })),
          { transaction, ignoreDuplicates: true }
        );
      }

      await transaction.commit();
      return post;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};

module.exports = communityPostService; 