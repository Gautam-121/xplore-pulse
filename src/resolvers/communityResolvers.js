// src/graphql/resolvers/communityResolvers.js

const { GraphQLError } = require('graphql');
const { Op } = require('sequelize');
const logger = require('../../utils/logger');
const db = require('../config/dbConfig');
const { requireAuth } = require('../middleware/auth');
const Community = db.Community;
const Interest = db.Interest;
const User = db.User;
const UserInterest = db.UserInterest;
const UserCommunity = db.UserCommunity;
const PaymentSession = db.PaymentSession; 

const communityResolvers = {
  Query: {
    recommendedCommunities: requireAuth(async (
        _,
        { limit = 10, offset = 0, sortBy = 'membersCount', sortOrder = 'DESC' },
        { user }
      ) => {
        try {
          logger.info('Fetching recommended communities', { userId: user.id });
          const interests = await UserInterest.findAll({
            where: { userId: user.id },
            attributes: ['interestId']
          });
  
          const interestIds = interests.map(i => i.interestId);
          const joined = await UserCommunity.findAll({
            where: { userId: user.id },
            attributes: ['communityId']
          });
  
          const joinedCommunityIds = joined.map(j => j.communityId);
          let whereClause = {
            isActive: true,
            id: { [Op.notIn]: joinedCommunityIds }
          };
  
          if (interestIds.length > 0) {
            whereClause['$interests.id$'] = { [Op.in]: interestIds };
          }
          const recommended = await Community.findAndCountAll({
            where: whereClause,
            include: [{
              model: Interest,
              as: 'interests',
              through: { attributes: [] }
            }],
            order: [[sortBy, sortOrder]],
            offset,
            limit
          });
          const enriched = recommended.rows.map(c => ({
            ...c.toJSON(),
            requiresPayment: c.isPaid
          }));
          logger.info('Recommended communities fetched', { count: recommended.rows.length });
          return {
            success: true,
            communities: enriched,
            totalCount: recommended.count,
            hasMore: offset + recommended.rows.length < recommended.count
          };
        } catch (error) {
          logger.error('Error fetching recommended communities', { error });
          if(error instanceof GraphQLError) throw error
          throw new GraphQLError('Failed to fetch recommended communities', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' }
          });
        }
    })
  },

  Mutation: {
    joinCommunity: requireAuth(async (_, { communityId }, { user }) => {  
        const transaction = await db.sequelize.transaction();
        try {
          const community = await Community.findByPk(communityId, { transaction });
          if (!community || !community.isActive){
            throw new GraphQLError('Community not found', { extensions: { code: 'NOT_FOUND' } });
          }
  
          const existing = await UserCommunity.findOne({
            where: { userId: user.id, communityId },
            transaction
          });
          if (existing) return { success: true, message: 'Already a member' };
  
          if (community.isPaid) {
            const stripeSession = await stripe.checkout.sessions.create({
              payment_method_types: ['card'],
              line_items: [{
                price_data: {
                  currency: community.currency.toLowerCase(),
                  product_data: { name: community.name },
                  unit_amount: parseInt(community.membershipFee * 100)
                },
                quantity: 1
              }],
              mode: 'payment',
              success_url: `${process.env.FRONTEND_URL}/payment-success`,
              cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled`
            });
  
            const session = await PaymentSession.create({
              userId: user.id,
              communityId,
              sessionId: stripeSession.id,
              orderId: stripeSession.id,
              amount: community.membershipFee,
              currency: community.currency,
              gatewayProvider: 'STRIPE',
              status: 'CREATED'
            }, { transaction });
  
            await transaction.commit();
            return {
              success: false,
              requiresPayment: true,
              paymentSessionId: session.id,
              paymentStatus: session.status,
              status: 'AWAITING_PAYMENT',
              message: 'Payment required to join community'
            };
          }
  
          await UserCommunity.create({
            userId: user.id,
            communityId,
            role: 'MEMBER',
            status: 'ACTIVE',
            joinedAt: new Date(),
            joinMethod: 'DIRECT'
          }, { transaction });
  
          await Community.increment('membersCount', { by: 1, where: { id: communityId }, transaction });
  
          await transaction.commit();
          return { success: true, message: 'Joined community successfully' };
        } catch (error) {
          await transaction.rollback();
          logger.error('joinCommunity error', { error });
          throw new GraphQLError('Internal server error', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
        }
    }),

    completeCommunityPayment: requireAuth(async (_, { sessionId }, { user }) => {
        if (!user) throw new GraphQLError('Authentication required', { extensions: { code: 'UNAUTHENTICATED' } });
      
        const transaction = await db.sequelize.transaction();
        try {
          const session = await db.PaymentSession.findOne({
            where: {
              id: sessionId,
              userId: user.id,
            },
            transaction
          });
      
          if (!session) {
            throw new GraphQLError('Session not found', { extensions: { code: 'NOT_FOUND' } });
          }
      
          if (session.status === 'COMPLETED') {
            // Already handled
            return { success: true, message: 'Payment already completed and community joined' };
          }
      
          // Optional: Fetch actual payment status from PG
          let isPaid = false;
      
          if (session.gatewayProvider === 'STRIPE' && session.gatewayPaymentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.gatewayPaymentId);
            isPaid = paymentIntent.status === 'succeeded';
          }
      
          // Add Razorpay logic here if needed
      
          if (!isPaid) {
            return {
              success: false,
              message: 'Payment is not yet confirmed. Please try again after a few seconds.'
            };
          }
      
          // Update DB
          await session.update({ status: 'COMPLETED' }, { transaction });
      
          const userCommunity = await db.UserCommunity.create({
            userId: user.id,
            communityId: session.communityId,
            joinedAt: new Date(),
            role: 'MEMBER',
            joinMethod: 'DIRECT',
            joinType: 'PAID',
            paymentStatus: 'COMPLETED',
            paymentSessionId: session.id,
            transactionId: session.gatewayPaymentId || session.transactionId,
            amountPaid: session.amount
          }, { transaction });
      
          await session.update({ userCommunityId: userCommunity.id }, { transaction });
      
          await db.Community.increment('membersCount', {
            by: 1,
            where: { id: session.communityId },
            transaction
          });
      
          await transaction.commit();
          return { success: true, message: 'Payment verified. Joined community successfully' };
      
        } catch (err) {
          await transaction.rollback();
          logger.error('Failed to complete community payment', { error: err });
          throw new GraphQLError('Internal server error', { extensions: { code: 'INTERNAL_ERROR' } });
        }
    })

  }
};

module.exports = communityResolvers;
