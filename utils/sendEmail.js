import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const emailProvider = String(
  process.env.EMAIL_PROVIDER || (process.env.SENDGRID_API_KEY ? "sendgrid" : "smtp")
).toLowerCase();
const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com";
const smtpPort = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 465);
const smtpSecure =
  process.env.SMTP_SECURE != null
    ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
    : smtpPort === 465;
const emailFrom = process.env.EMAIL_FROM || `"Voting System" <${process.env.EMAIL_USER}>`;
const emailPass = String(process.env.EMAIL_PASS || "").replace(/\s+/g, "");
const smtpPoolEnabled = String(process.env.SMTP_POOL || "true").toLowerCase() !== "false";
const smtpMaxConnections = Number(process.env.SMTP_MAX_CONNECTIONS || 1);
const smtpMaxMessages = Number(process.env.SMTP_MAX_MESSAGES || 25);
const sendGridApiKey = process.env.SENDGRID_API_KEY;
const sendGridFrom = process.env.SENDGRID_FROM || emailFrom;
const sendGridReplyTo = process.env.SENDGRID_REPLY_TO;

const getEmailErrorDetails = (error) =>
  [
    error?.message,
    error?.code ? `code=${error.code}` : "",
    error?.command ? `command=${error.command}` : "",
    error?.responseCode ? `responseCode=${error.responseCode}` : "",
    error?.response?.body ? `response=${JSON.stringify(error.response.body)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

if (sendGridApiKey) {
  sgMail.setApiKey(sendGridApiKey);
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  pool: smtpPoolEnabled,
  maxConnections: smtpMaxConnections,
  maxMessages: smtpMaxMessages,
  auth: {
    user: process.env.EMAIL_USER,
    pass: emailPass,
  },
  requireTLS: smtpPort === 587,
  tls: {
    minVersion: "TLSv1.2",
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

export const verifyEmailTransport = async () => {
  if (emailProvider === "sendgrid") {
    if (!sendGridApiKey) {
      console.error("Email transport verification failed: SENDGRID_API_KEY is required");
      return false;
    }

    if (!sendGridFrom) {
      console.error("Email transport verification failed: SENDGRID_FROM or EMAIL_FROM is required");
      return false;
    }

    console.log("Email transport ready (sendgrid)");
    return true;
  }

  if (!process.env.EMAIL_USER || !emailPass) {
    console.error("Email transport verification failed: EMAIL_USER and EMAIL_PASS are required");
    return false;
  }

  try {
    await transporter.verify();
    console.log(`Email transport ready (${smtpHost}:${smtpPort}, secure=${smtpSecure})`);
    return true;
  } catch (error) {
    console.error("Email transport verification failed:", getEmailErrorDetails(error));
    return false;
  }
};

const sendEmail = async (to, subjectOrContent, maybeText) => {
  const subject = maybeText ? subjectOrContent : "Your Voting OTP";
  const text = maybeText ?? subjectOrContent;

  try {
    if (emailProvider === "sendgrid") {
      await sgMail.send({
        to,
        from: sendGridFrom,
        replyTo: sendGridReplyTo || undefined,
        subject,
        text,
      });
      console.log("Email dispatched via SendGrid");
      return;
    }

    await transporter.sendMail({
      from: emailFrom,
      to,
      subject,
      text,
    });
    console.log("Email dispatched via SMTP");
  } catch (error) {
    console.error("Error sending email:", getEmailErrorDetails(error));
    throw new Error(`Failed to send email: ${getEmailErrorDetails(error)}`);
  }
};

export default sendEmail;
