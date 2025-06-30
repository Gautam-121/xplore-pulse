const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOTPEmail(to, otp) {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@xplore.app',
      to,
      subject: 'Your Xplore OTP Code',
      text: `Your OTP code is: ${otp}`,
      html: `<p>Your OTP code is: <b>${otp}</b></p>`
    });
    logger.info('OTP email sent to %s: %s', {to, messageId: info.messageId});
    return true;
  } catch (err) {
    logger.error('Failed to send OTP email to %s: %o', {to, err});
    return false;
  }
}

module.exports = { sendOTPEmail }; 