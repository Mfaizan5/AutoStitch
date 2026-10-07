const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  // No mail account configured: in development, skip sending instead of failing,
  // and tell the caller so it can show the content (e.g. the OTP) another way.
  if ((!process.env.EMAIL_USER || !process.env.EMAIL_PASS) && process.env.NODE_ENV !== 'production') {
    console.warn(`[SMTP] EMAIL_USER / EMAIL_PASS not set. Skipped email to ${options.email}: "${options.subject}"`);
    return { delivered: false };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  console.log(`[SMTP] Attempting to send email to: ${options.email}...`);

  const mailOptions = {
    from: `"Auto Stitch Support" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[SMTP] Email sent successfully! MessageId: ${info.messageId}`);
  return { delivered: true };
};

module.exports = sendEmail;
