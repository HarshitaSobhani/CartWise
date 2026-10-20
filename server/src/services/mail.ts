import nodemailer, { type Transporter } from 'nodemailer';
import { config, mailConfigured } from '../config.js';

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

let transport: Transporter | null = null;

/** Real SMTP sender. Only usable when SMTP_HOST and MAIL_FROM are configured. */
export const smtpMailer: Mailer | null = mailConfigured
  ? async (to, subject, text) => {
      transport ??= nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      });
      await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
    }
  : null;
