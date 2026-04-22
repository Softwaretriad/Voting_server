import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure =
  process.env.SMTP_SECURE != null
    ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
    : smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    minVersion: "TLSv1.2",
  },
});

export const verifyEmailTransport = async () => {
  try {
    await transporter.verify();
    console.log(`Email transport ready (${smtpHost}:${smtpPort})`);
    return true;
  } catch (error) {
    console.error("Email transport verification failed:", error.message);
    return false;
  }
};

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
