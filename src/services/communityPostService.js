const db = require('../config/dbConfig');
const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const ValidationService = require('../utils/validation');
const CommunityPost = db.CommunityPost;
const CommunityMember = db.CommunityMember;
const PostMention = db.PostMention;
const User = db.User;
const sequelize = db.sequelize;
const Community = db.Community; // Added Community import

// Helper: Validate URL (simple robust regex)
function isValidUrl(url) {
  const urlRegex = /^(https?:\/\/)[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\]@!$&'()*+,;=.]+$/i;
  return typeof url === 'string' && urlRegex.test(url);
}

function sanitizeString(str) {
  return typeof str === 'string' ? str.trim() : str;
}

const POST_TYPE_ENUM = ['TEXT', 'IMAGE', 'VIDEO', 'LINK', 'POLL', 'EDUCATIONAL', 'QUIZ', 'MIXED'];
const MEDIA_TYPE_ENUM = ['IMAGE', 'VIDEO'];
const VISIBILITY_ENUM = ['PUBLIC', 'MEMBERS_ONLY', 'ADMINS_ONLY', 'PRIVATE'];

const TITLE_MIN = 2, TITLE_MAX = 200;
const CONTENT_MIN = 0, CONTENT_MAX = 5000;
const TAGS_MAX = 10, TAG_MAX_LEN = 32;

const communityPostService = {
  async createCommunityPost(input, userId) {
    let transaction;
    try {
      let {
        communityId, type, title, content, media, linkUrl, linkTitle, linkDescription, linkImageUrl,
        quizzes, pollOptions, tags, mentions, visibility, isSponsored,
        pollOpen, pollCloseAt, quizOpen, quizCloseAt
      } = input;

      // Input sanitization
      title = sanitizeString(title);
      content = sanitizeString(content);
      linkUrl = sanitizeString(linkUrl);
      linkTitle = sanitizeString(linkTitle);
      linkDescription = sanitizeString(linkDescription);
      linkImageUrl = sanitizeString(linkImageUrl);
      if (tags) tags = tags.map(sanitizeString);
      if (media) media = media.map(m => ({ ...m, altText: sanitizeString(m.altText) }));

      // Validate All mentionId
      if(mentions && mentions.length > 0) {
        ValidationService.validateArrayOfUUIDs(mentions , "mentionId");
        // Ensure all mention IDs are unique
        const uniqueMentions = new Set(mentions);
        if (uniqueMentions.size !== mentions.length) {
          throw new GraphQLError('Mentioned user IDs must be unique.', { extensions: { code: 'DUPLICATE_MENTION' } });
        }
        // Mention limit
        if (mentions.length > 20) {
          throw new GraphQLError('A post can have at most 20 mentions.', { extensions: { code: 'TOO_MANY_MENTIONS' } });
        }
        // Self-mention check
        if (mentions.includes(userId)) {
          throw new GraphQLError('You cannot mention yourself.', { extensions: { code: 'SELF_MENTION' } });
        }
      }

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
        // Tag limit (e.g., 20)
        if (tags.length > 20) throw new GraphQLError('A post can have at most 20 tags.', { extensions: { code: 'TOO_MANY_TAGS' } });
        // Tag uniqueness
        const uniqueTags = new Set(tags);
        if (uniqueTags.size !== tags.length) {
          throw new GraphQLError('Tags must be unique.', { extensions: { code: 'DUPLICATE_TAG' } });
        }
        tags.forEach((tag, idx) => {
          if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > TAG_MAX_LEN) {
            throw new GraphQLError(`Tag at index ${idx} is invalid or too long (max ${TAG_MAX_LEN}).`, { extensions: { code: 'INVALID_TAG' } });
          }
        });
      }

      if (['IMAGE', 'VIDEO', 'MIXED'].includes(type)) {
        if (!Array.isArray(media) || media.length === 0) {
          throw new GraphQLError('Media array is required for image, video, or mixed posts.', { extensions: { code: 'MEDIA_REQUIRED' } });
        }
      }

      // 6. Validate media (if present)
      if (media) {
        if (!Array.isArray(media)) throw new GraphQLError('Media must be an array.', { extensions: { code: 'INVALID_MEDIA' } });
        if (media.length > 10) throw new GraphQLError('A post can have at most 10 media items.', { extensions: { code: 'MEDIA_LIMIT_EXCEEDED' } });
        // Media uniqueness
        const mediaUrls = media.map(m => m.url);
        if (new Set(mediaUrls).size !== mediaUrls.length) {
          throw new GraphQLError('Duplicate media URLs are not allowed.', { extensions: { code: 'DUPLICATE_MEDIA' } });
        }
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

      // 7. Validate link fields (if any are present)
      const hasAnyLinkField = !!(linkUrl || linkTitle || linkDescription || linkImageUrl);
      if (hasAnyLinkField) {
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
        // Link duplicate check
        if (media && media.some(m => m.url === linkUrl)) {
          throw new GraphQLError('Link URL cannot be the same as a media URL.', { extensions: { code: 'DUPLICATE_LINK_MEDIA' } });
        }
      }

      if(type === "QUIZ" && (!quizzes || quizzes.length === 0)){
        throw new GraphQLError('At least one quiz is required.', { extensions: { code: 'INVALID_QUIZ' } });
      }

      if(type === "POLL" && (!pollOptions || pollOptions.length === 0)){
        throw new GraphQLError('Poll must have at least 2 options.', { extensions: { code: 'INVALID_POLL_OPTIONS' } });
      }

      // 8. Validate quizzes (if present)
      let quizzesData = [];
      // --- Advanced poll/quiz open/close validation ---
      if (type === 'POLL') {
        // pollOpen defaults to true if not provided
        if (typeof pollOpen !== 'boolean') pollOpen = true;
        // pollCloseAt must be in the future if provided
        if (pollCloseAt && new Date(pollCloseAt) <= new Date()) {
          throw new GraphQLError('Poll close time must be in the future.', { extensions: { code: 'INVALID_POLL_CLOSE_TIME' } });
        }
      }
      if (type === 'QUIZ') {
        if (typeof quizOpen !== 'boolean') quizOpen = true;
        if (quizCloseAt && new Date(quizCloseAt) <= new Date()) {
          throw new GraphQLError('Quiz close time must be in the future.', { extensions: { code: 'INVALID_QUIZ_CLOSE_TIME' } });
        }
      }
      // --- Advanced poll/quiz option validation ---
      if (type === 'POLL') {
        if (!Array.isArray(pollOptions) || pollOptions.length < 2 || pollOptions.length > 10) {
          throw new GraphQLError('Poll must have 2-10 options.', { extensions: { code: 'INVALID_POLL_OPTIONS' } });
        }
        const texts = pollOptions.map(opt => opt.text.trim());
        if (new Set(texts).size !== texts.length) {
          throw new GraphQLError('Poll options must be unique.', { extensions: { code: 'DUPLICATE_POLL_OPTION' } });
        }
        pollOptions.forEach((opt, idx) => {
          if (!opt.text || typeof opt.text !== 'string' || opt.text.length < 1 || opt.text.length > 200) {
            throw new GraphQLError(`Poll option at index ${idx} must be 1-200 characters.`, { extensions: { code: 'INVALID_POLL_OPTION' } });
          }
        });
      }
      if (type === 'QUIZ') {
        if (!Array.isArray(quizzes) || quizzes.length === 0) {
          throw new GraphQLError('At least one quiz is required.', { extensions: { code: 'INVALID_QUIZ' } });
        }
        quizzes.forEach((quiz, idx) => {
          if (!quiz.question || typeof quiz.question !== 'string' || quiz.question.length < 2 || quiz.question.length > 500) {
            throw new GraphQLError(`Quiz question at index ${idx} must be 2-500 characters.`, { extensions: { code: 'INVALID_QUIZ_QUESTION' } });
          }
          if (!Array.isArray(quiz.options) || quiz.options.length < 2 || quiz.options.length > 10) {
            throw new GraphQLError(`Quiz at index ${idx} must have 2-10 options.`, { extensions: { code: 'INVALID_QUIZ_OPTIONS' } });
          }
          const quizOptionTexts = quiz.options.map(opt => opt.text.trim());
          if (new Set(quizOptionTexts).size !== quizOptionTexts.length) {
            throw new GraphQLError(`Quiz options at quiz ${idx} must be unique.`, { extensions: { code: 'DUPLICATE_QUIZ_OPTION' } });
          }
          quiz.options.forEach((opt, oidx) => {
            if (!opt.text || typeof opt.text !== 'string' || opt.text.length < 1 || opt.text.length > 200) {
              throw new GraphQLError(`Quiz option at quiz ${idx}, option ${oidx} must be 1-200 characters.`, { extensions: { code: 'INVALID_QUIZ_OPTION' } });
            }
          });
        });
        quizzesData = quizzes;
      }

      // 9. Validate poll options (if present)
      let pollOptionsData = [];
      if (pollOptions) {
        if (!Array.isArray(pollOptions) || (type === 'POLL' && pollOptions.length < 2)) throw new GraphQLError('Poll must have at least 2 options.', { extensions: { code: 'INVALID_POLL_OPTIONS' } });
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

      // 10. Forbid illogical combinations
      if (pollOptions && quizzes) {
        throw new GraphQLError('A post cannot have both pollOptions and quizzes.', { extensions: { code: 'INVALID_COMBINATION' } });
      }

      // 11. Validate mentions
      let mentionUserIds = [];
      if (Array.isArray(mentions) && mentions.length > 0) {
        const users = await User.findAll({ where: { id: { [Op.in]: mentions } } });
        if (users.length !== mentions.length) {
          throw new GraphQLError('One or more mentioned users do not exist.', { extensions: { code: 'INVALID_MENTION' } });
        }
        mentionUserIds = mentions;
      }

      // 12. Validate visibility
      if (visibility && !VISIBILITY_ENUM.includes(visibility)) {
        throw new GraphQLError('Invalid visibility value.', { extensions: { code: 'INVALID_VISIBILITY' } });
      }

      // 13. Transaction for atomicity
      transaction = await sequelize.transaction();
      try {
        // 14. Create the post
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
          visibility: 'MEMBERS_ONLY',
          isSponsored: !!isSponsored,
          pollOpen,
          pollCloseAt,
          quizOpen,
          quizCloseAt
        }, { transaction });

        // Increment postCount in Community
        await Community.increment('postCount', { by: 1, where: { id: communityId }, transaction });

        // 15. Insert mentions
        if (mentionUserIds.length > 0) {
          await PostMention.bulkCreate(
            mentionUserIds.map(uid => ({ postId: post.id, userId: uid })),
            { transaction, ignoreDuplicates: true }
          );
        }

        await transaction.commit();
        return post;
      } catch (err) {
        if (transaction && !transaction.finished) await transaction.rollback();
        throw err;
      }
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to create community post', {
        extensions: { code: 'CREATE_POST_FAILED' }
      });
    }
  },
  async updateCommunityPost(postId, input, userId) {
    let transaction;
    try {
      // 1. Fetch the post
      const post = await CommunityPost.findByPk(postId);
      if (!post) throw new GraphQLError('Post not found', { extensions: { code: 'NOT_FOUND' } });

      // 2. Authorization: Only author or admin/moderator/owner
      const communityId = post.communityId;
      const membership = await CommunityMember.findOne({ where: { communityId, userId, status: 'APPROVED' } });
      const isAuthor = post.authorId === userId;
      const isAdmin = membership && ['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role);
      if (!isAuthor && !isAdmin) throw new GraphQLError('Not authorized to update this post', { extensions: { code: 'FORBIDDEN' } });

      // 3. Only allow updatable fields
      const updatableFields = [
        'title', 'content', 'tags', 'media', 'linkUrl', 'linkTitle', 'linkDescription', 'linkImageUrl', 'mentions', 'visibility', 'isSponsored'
      ];
      const updateData = {};
      for (const field of updatableFields) {
        if (input[field] !== undefined) {
          updateData[field] = input[field];
        }
      }

      // Input sanitization
      if (updateData.title !== undefined) updateData.title = sanitizeString(updateData.title);
      if (updateData.content !== undefined) updateData.content = sanitizeString(updateData.content);
      if (updateData.linkUrl !== undefined) updateData.linkUrl = sanitizeString(updateData.linkUrl);
      if (updateData.linkTitle !== undefined) updateData.linkTitle = sanitizeString(updateData.linkTitle);
      if (updateData.linkDescription !== undefined) updateData.linkDescription = sanitizeString(updateData.linkDescription);
      if (updateData.linkImageUrl !== undefined) updateData.linkImageUrl = sanitizeString(updateData.linkImageUrl);
      if (updateData.tags !== undefined) updateData.tags = updateData.tags.map(sanitizeString);
      if (updateData.media !== undefined) updateData.media = updateData.media.map(m => ({ ...m, altText: sanitizeString(m.altText) }));

      // 4. Validate each updated field as on create
      if (updateData.title !== undefined) {
        if (typeof updateData.title !== 'string' || updateData.title.length < TITLE_MIN || updateData.title.length > TITLE_MAX) {
          throw new GraphQLError(`Title must be ${TITLE_MIN}-${TITLE_MAX} characters.`, { extensions: { code: 'INVALID_TITLE' } });
        }
      }
      if (updateData.content !== undefined) {
        if (typeof updateData.content !== 'string' || updateData.content.length < CONTENT_MIN || updateData.content.length > CONTENT_MAX) {
          throw new GraphQLError(`Content must be ${CONTENT_MIN}-${CONTENT_MAX} characters.`, { extensions: { code: 'INVALID_CONTENT' } });
        }
      }
      if (updateData.tags !== undefined) {
        if (!Array.isArray(updateData.tags)) throw new GraphQLError('Tags must be an array.', { extensions: { code: 'INVALID_TAGS' } });
        if (updateData.tags.length > TAGS_MAX) throw new GraphQLError(`A post can have at most ${TAGS_MAX} tags.`, { extensions: { code: 'TOO_MANY_TAGS' } });
        // Tag limit (e.g., 20)
        if (updateData.tags.length > 20) throw new GraphQLError('A post can have at most 20 tags.', { extensions: { code: 'TOO_MANY_TAGS' } });
        // Tag uniqueness
        const uniqueTags = new Set(updateData.tags);
        if (uniqueTags.size !== updateData.tags.length) {
          throw new GraphQLError('Tags must be unique.', { extensions: { code: 'DUPLICATE_TAG' } });
        }
        updateData.tags.forEach((tag, idx) => {
          if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > TAG_MAX_LEN) {
            throw new GraphQLError(`Tag at index ${idx} is invalid or too long (max ${TAG_MAX_LEN}).`, { extensions: { code: 'INVALID_TAG' } });
          }
        });
      }
      if (updateData.media !== undefined) {
        if (!Array.isArray(updateData.media)) throw new GraphQLError('Media must be an array.', { extensions: { code: 'INVALID_MEDIA' } });
        if (updateData.media.length > 10) throw new GraphQLError('A post can have at most 10 media items.', { extensions: { code: 'MEDIA_LIMIT_EXCEEDED' } });
        // Media uniqueness
        const mediaUrls = updateData.media.map(m => m.url);
        if (new Set(mediaUrls).size !== mediaUrls.length) {
          throw new GraphQLError('Duplicate media URLs are not allowed.', { extensions: { code: 'DUPLICATE_MEDIA' } });
        }
        updateData.media.forEach((item, idx) => {
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
      }
      // Link fields
      const hasAnyLinkField = !!(updateData.linkUrl || updateData.linkTitle || updateData.linkDescription || updateData.linkImageUrl);
      if (hasAnyLinkField) {
        if (!updateData.linkUrl || !isValidUrl(updateData.linkUrl)) {
          throw new GraphQLError('A valid linkUrl is required for link posts.', { extensions: { code: 'INVALID_LINK_URL' } });
        }
        if (updateData.linkTitle && (typeof updateData.linkTitle !== 'string' || updateData.linkTitle.length > 200)) {
          throw new GraphQLError('linkTitle must be a string up to 200 characters.', { extensions: { code: 'INVALID_LINK_TITLE' } });
        }
        if (updateData.linkDescription && (typeof updateData.linkDescription !== 'string' || updateData.linkDescription.length > 1000)) {
          throw new GraphQLError('linkDescription must be a string up to 1000 characters.', { extensions: { code: 'INVALID_LINK_DESCRIPTION' } });
        }
        if (updateData.linkImageUrl && !isValidUrl(updateData.linkImageUrl)) {
          throw new GraphQLError('linkImageUrl must be a valid URL.', { extensions: { code: 'INVALID_LINK_IMAGE_URL' } });
        }
        // Link duplicate check
        if (updateData.media && updateData.media.some(m => m.url === updateData.linkUrl)) {
          throw new GraphQLError('Link URL cannot be the same as a media URL.', { extensions: { code: 'DUPLICATE_LINK_MEDIA' } });
        }
      }
      // Mentions
      if (updateData.mentions !== undefined) {
        ValidationService.validateArrayOfUUIDs(updateData.mentions, 'mentionId');
        // Ensure all mention IDs are unique
        const uniqueMentions = new Set(updateData.mentions);
        if (uniqueMentions.size !== updateData.mentions.length) {
          throw new GraphQLError('Mentioned user IDs must be unique.', { extensions: { code: 'DUPLICATE_MENTION' } });
        }
        // Mention limit
        if (updateData.mentions.length > 20) {
          throw new GraphQLError('A post can have at most 20 mentions.', { extensions: { code: 'TOO_MANY_MENTIONS' } });
        }
        // Self-mention check
        if (updateData.mentions.includes(userId)) {
          throw new GraphQLError('You cannot mention yourself.', { extensions: { code: 'SELF_MENTION' } });
        }
        // Validate all mentioned users exist
        const users = await User.findAll({ where: { id: { [Op.in]: updateData.mentions } } });
        if (users.length !== updateData.mentions.length) {
          throw new GraphQLError('One or more mentioned users do not exist.', { extensions: { code: 'INVALID_MENTION' } });
        }
      }
      // Visibility
      if (updateData.visibility !== undefined && !VISIBILITY_ENUM.includes(updateData.visibility)) {
        throw new GraphQLError('Invalid visibility value.', { extensions: { code: 'INVALID_VISIBILITY' } });
      }
      // isSponsored: no extra validation needed

      // 5. Forbid changing type, author, community
      if (input.type !== undefined && input.type !== post.type) {
        throw new GraphQLError('Cannot change post type after creation.', { extensions: { code: 'IMMUTABLE_FIELD' } });
      }
      if (input.authorId !== undefined && input.authorId !== post.authorId) {
        throw new GraphQLError('Cannot change post author.', { extensions: { code: 'IMMUTABLE_FIELD' } });
      }
      if (input.communityId !== undefined && input.communityId !== post.communityId) {
        throw new GraphQLError('Cannot change post community.', { extensions: { code: 'IMMUTABLE_FIELD' } });
      }
      // Poll/Quiz options: only allow update if no responses
      if (input.pollOptions !== undefined) {
        // Check for existing poll answers
        const pollAnswerCount = await db.PollAnswer.count({ where: { postId } });
        if (pollAnswerCount > 0) {
          throw new GraphQLError('Cannot edit poll options after votes have been cast.', { extensions: { code: 'IMMUTABLE_FIELD' } });
        }
        // Validate pollOptions as on create
        if (!Array.isArray(input.pollOptions) || input.pollOptions.length < 2) throw new GraphQLError('Poll must have at least 2 options.', { extensions: { code: 'INVALID_POLL_OPTIONS' } });
        updateData.pollOptions = input.pollOptions.map(opt => {
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
      if (input.quizzes !== undefined) {
        // Check for existing quiz responses
        const quizResponseCount = await db.QuizResponse.count({ where: { postId } });
        if (quizResponseCount > 0) {
          throw new GraphQLError('Cannot edit quiz after answers have been submitted.', { extensions: { code: 'IMMUTABLE_FIELD' } });
        }
        // Validate quizzes as on create
        if (!Array.isArray(input.quizzes) || input.quizzes.length === 0) throw new GraphQLError('At least one quiz is required.', { extensions: { code: 'INVALID_QUIZ' } });
        input.quizzes.forEach((quiz, idx) => {
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
        updateData.quizzes = input.quizzes;
      }
      // 6. Transaction for atomicity
      transaction = await sequelize.transaction();
      try {
        // 7. Update the post
        await post.update(updateData, { transaction });
        // 8. Update mentions (PostMention table)
        if (input.mentions !== undefined) {
          await PostMention.destroy({ where: { postId }, transaction });
          if (input.mentions.length > 0) {
            await PostMention.bulkCreate(
              input.mentions.map(uid => ({ postId, userId: uid })),
              { transaction, ignoreDuplicates: true }
            );
          }
        }
        await transaction.commit();
        return await post.reload();
      } catch (err) {
        if (transaction && !transaction.finished) await transaction.rollback();
        throw err;
      }
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to update community post', {
        extensions: { code: 'UPDATE_POST_FAILED' }
      });
    }
  },
  async deleteCommunityPost(postId, userId) {
    let transaction;
    try {
      // 1. Fetch the post
      const post = await CommunityPost.findByPk(postId);
      if (!post) throw new GraphQLError('Post not found', { extensions: { code: 'NOT_FOUND' } });

      // 2. Authorization: Only author or admin/moderator/owner
      const communityId = post.communityId;
      const membership = await CommunityMember.findOne({ where: { communityId, userId, status: 'APPROVED' } });
      const isAuthor = post.authorId === userId;
      const isAdmin = membership && ['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role);
      if (!isAuthor && !isAdmin) throw new GraphQLError('Not authorized to delete this post', { extensions: { code: 'FORBIDDEN' } });

      // 3. Check if already deleted (soft delete)
      if ('isDeleted' in post && post.isDeleted) throw new GraphQLError('Post already deleted', { extensions: { code: 'ALREADY_DELETED' } });

      // 4. Transaction for atomicity
      transaction = await sequelize.transaction();
      try {
        // 5. Cascade delete related records
        await PostMention.destroy({ where: { postId }, transaction });
        await db.PostReaction.destroy({ where: { postId }, transaction });
        await db.PostBookmark.destroy({ where: { postId }, transaction });
        await db.PollAnswer.destroy({ where: { postId }, transaction });
        await db.QuizResponse.destroy({ where: { postId }, transaction });

        // 6. Delete media files from storage if present
        if (post.media && Array.isArray(post.media)) {
          const fileUploadService = require('./fileUploadService');
          for (const media of post.media) {
            if (media.url) {
              try {
                await fileUploadService.deleteFile(media.url);
              } catch (err) {
                // Log and continue
                // logger.warn('Failed to delete media file', { url: media.url, error: err.message });
              }
            }
            if (media.thumbnailUrl) {
              try {
                await fileUploadService.deleteFile(media.thumbnailUrl);
              } catch (err) {}
            }
          }
        }

        // 7. Soft delete if possible, else hard delete
        if ('isDeleted' in post) {
          await post.update({ isDeleted: true, deletedAt: new Date() }, { transaction });
        } else {
          await post.destroy({ transaction });
        }

        // Decrement postCount in Community
        await Community.decrement('postCount', { by: 1, where: { id: post.communityId }, transaction });

        await transaction.commit();
        return { success: true, message: 'Post deleted successfully', postId };
      } catch (err) {
        if (transaction && !transaction.finished) await transaction.rollback();
        throw err;
      }
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to delete community post', {
        extensions: { code: 'DELETE_POST_FAILED' }
      });
    }
  },
  async closePoll(postId, userId) {
    try {
      // 1. Find post
      const post = await CommunityPost.findByPk(postId, { paranoid: false });
      if (!post || post.type !== 'POLL') {
        throw new GraphQLError('Poll post not found.', { extensions: { code: 'NOT_FOUND' } });
      }
      if (post.deletedAt) {
        throw new GraphQLError('This poll post has been deleted.', { extensions: { code: 'POST_DELETED' } });
      }
      if (post.pollOpen === false) {
        return { success: true, message: 'Poll is already closed.' };
      }
      // 2. Permission: author, owner, admin, moderator
      const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId } });
      if (!membership || !['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role)) {
        if (post.authorId !== userId) {
          throw new GraphQLError('Only the post author, community owner, admin, or moderator can close the poll.', { extensions: { code: 'FORBIDDEN' } });
        }
      }
      // 3. Close poll
      post.pollOpen = false;
      await post.save();
      return { success: true, message: 'Poll closed successfully.' };
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to close poll', { extensions: { code: 'CLOSE_POLL_FAILED' } });
    }
  },
  async closeQuiz(postId, userId) {
    try {
      // 1. Find post
      const post = await CommunityPost.findByPk(postId, { paranoid: false });
      if (!post || post.type !== 'QUIZ') {
        throw new GraphQLError('Quiz post not found.', { extensions: { code: 'NOT_FOUND' } });
      }
      if (post.deletedAt) {
        throw new GraphQLError('This quiz post has been deleted.', { extensions: { code: 'POST_DELETED' } });
      }
      if (post.quizOpen === false) {
        return { success: true, message: 'Quiz is already closed.' };
      }
      // 2. Permission: author, owner, admin, moderator
      const membership = await CommunityMember.findOne({ where: { communityId: post.communityId, userId } });
      if (!membership || !['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role)) {
        if (post.authorId !== userId) {
          throw new GraphQLError('Only the post author, community owner, admin, or moderator can close the quiz.', { extensions: { code: 'FORBIDDEN' } });
        }
      }
      // 3. Close quiz
      post.quizOpen = false;
      await post.save();
      return { success: true, message: 'Quiz closed successfully.' };
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(error?.message || 'Failed to close quiz', { extensions: { code: 'CLOSE_QUIZ_FAILED' } });
    }
  }
};

module.exports = communityPostService; 