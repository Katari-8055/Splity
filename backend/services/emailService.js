import nodemailer from 'nodemailer';

export async function sendActualEmail(to, subject, textMessage, htmlMessage) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('[EMAIL] Credentials not configured. Logging to console instead.');
      console.log(`[EMAIL FALLBACK] To: ${to}, Subject: ${subject}`);
      return true;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: {
        name: 'spendsavvy Safety Monitor',
        address: process.env.EMAIL_USER
      },
      to,
      subject,
      html: htmlMessage,
      text: textMessage
    };

    await transporter.sendMail(mailOptions);
    console.log('[EMAIL] ✅ Email sent successfully to:', to);
    return true;
  } catch (error) {
    console.error(`[EMAIL] Error sending email to ${to}:`, error);
    return false;
  }
}

export async function testEmailConfiguration() {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return false;
    }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    await transporter.verify();
    return true;
  } catch (error) {
    console.error('[EMAIL TEST] Email config test failed:', error);
    return false;
  }
}
