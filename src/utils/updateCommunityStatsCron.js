const cron = require('node-cron');
const db = require('../config/dbConfig');
const { Op, fn, col } = require('sequelize');
const logger = require('./logger');

const Community = db.Community;
const CommunityMember = db.CommunityMember;
const CommunityPost = db.CommunityPost;
const PostReaction = db.PostReaction;

// Helper to get date X days ago
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function updateCommunityStats() {
  logger.info('[CRON] Starting community stats update for trending logic...');
  try {
    const communities = await Community.findAll();
    const now = new Date();
    const weekAgo = daysAgo(7);

    for (const community of communities) {
      // 1. Weekly growth: new members in last 7 days
      const weeklyGrowth = await CommunityMember.count({
        where: {
          communityId: community.id,
          joinedAt: { [Op.gte]: weekAgo }
        }
      });
      // 2. Recent posts: posts in last 7 days
      const recentPosts = await CommunityPost.count({
        where: {
          communityId: community.id,
          createdAt: { [Op.gte]: weekAgo }
        }
      });
      // 3. Recent reactions: reactions in last 7 days
      const recentReactions = await PostReaction.count({
        where: {
          communityId: community.id,
          createdAt: { [Op.gte]: weekAgo }
        }
      });
      // 4. Last post timestamp
      const lastPost = await CommunityPost.findOne({
        where: { communityId: community.id },
        order: [['createdAt', 'DESC']],
        attributes: ['createdAt']
      });
      const lastPostAt = lastPost ? lastPost.createdAt : null;

      // Update stats JSONB
      const stats = {
        ...(community.stats || {}),
        weeklyGrowth,
        recentPosts,
        recentReactions,
        lastPostAt
      };
      await community.update({ stats });
    }
    logger.info('[CRON] Community stats update complete.');
  } catch (err) {
    logger.error('[CRON] Error updating community stats:', err);
  }
}

// Schedule to run every hour
cron.schedule('0 * * * *', updateCommunityStats);

// If run directly, execute once
if (require.main === module) {
  updateCommunityStats().then(() => process.exit(0));
} 