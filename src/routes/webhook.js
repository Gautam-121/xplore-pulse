// const express = require('express');
// const router = express.Router();
// const db = require('../models');
// const stripe = require('stripe')
// const logger = require('../utils/logger');

// router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//   } catch (err) {
//     logger.error('Stripe webhook signature verification failed', { err });
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   if (event.type === 'checkout.session.completed') {
//     const session = event.data.object;
//     const gatewayPaymentId = session.payment_intent;

//     const paymentSession = await db.PaymentSession.findOne({ where: { sessionId: session.id } });
//     if (!paymentSession) return res.status(404).send('Session not found');

//     await paymentSession.update({
//       status: 'COMPLETED',
//       gatewayPaymentId,
//       webhookReceived: true,
//       webhookData: session
//     });

//     const userCommunity = await db.UserCommunity.create({
//       userId: paymentSession.userId,
//       communityId: paymentSession.communityId,
//       role: 'MEMBER',
//       status: 'ACTIVE',
//       joinedAt: new Date(),
//       joinMethod: 'DIRECT',
//       paymentStatus: 'COMPLETED',
//       paymentSessionId: session.id,
//       transactionId: gatewayPaymentId,
//       amountPaid: paymentSession.amount
//     });

//     await paymentSession.update({ userCommunityId: userCommunity.id });
//     await db.Community.increment('membersCount', { by: 1, where: { id: paymentSession.communityId } });
//   }

//   res.status(200).json({ received: true });
// });