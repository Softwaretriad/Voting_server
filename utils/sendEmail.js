import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail", // or use smtp: { host, port, secure, auth }
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // app password (not your real Gmail password)
  },
});

const sendEmail = async (to, content) => {
  try {
    await transporter.sendMail({
      from: `"Voting System" <${process.env.EMAIL_USER}>`,
      to,
      subject: "Your Voting OTP",
      text: content,
    });
    console.log(`✅ Email sent to ${to}`);
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    throw new Error("Failed to send OTP email");
  }
};

export default sendEmail;
