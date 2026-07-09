import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * SMTP email sender. Fully functional once SMTP_* env vars are provided;
 * otherwise it degrades gracefully (logs and reports "not configured") so the
 * rest of the notification pipeline keeps working without email credentials.
 */
@Injectable()
export class EmailSender {
  private readonly logger = new Logger('EmailSender');
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const host = process.env.SMTP_HOST;
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    }
  }

  get configured(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
    if (!this.transporter) {
      this.logger.log(`[email skipped: SMTP not configured] to=${to} subject="${subject}"`);
      return { sent: false, reason: 'smtp_not_configured' };
    }
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? 'ClassWeb <no-reply@nursing.au.edu>',
        to, subject, text,
      });
      return { sent: true };
    } catch (e) {
      this.logger.error(`Email send failed: ${(e as Error).message}`);
      return { sent: false, reason: (e as Error).message };
    }
  }
}
