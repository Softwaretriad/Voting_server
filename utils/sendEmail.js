import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (to, subjectOrContent, maybeText, maybeOptions = {}) => {
  const subject = maybeText ? subjectOrContent : "Your Voting OTP";
  const text = maybeText ?? subjectOrContent;
  const options =
    maybeText && typeof maybeOptions === "object" ? maybeOptions : {};

  try {
    await transporter.sendMail({
      from: `"Voting System" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      attachments: options.attachments || [],
    });
    console.log("Email dispatched");
  } catch (error) {
    console.error("Error sending email:", error.message);
    throw new Error("Failed to send email");
  }
};

export default sendEmail;
