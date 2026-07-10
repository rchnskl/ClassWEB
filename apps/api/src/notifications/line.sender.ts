import { Injectable, Logger } from '@nestjs/common';

/**
 * LINE Messaging API push sender. Fully functional once
 * LINE_CHANNEL_ACCESS_TOKEN is set (create a Messaging API channel at
 * https://developers.line.biz/) and a recipient has linked their LINE user
 * id (User.lineUserId); otherwise it degrades gracefully so the rest of the
 * notification pipeline keeps working without a LINE channel configured.
 */
@Injectable()
export class LineSender {
  private readonly logger = new Logger('LineSender');
  private readonly token = process.env.LINE_CHANNEL_ACCESS_TOKEN || null;

  get configured(): boolean {
    return this.token !== null;
  }

  async send(lineUserId: string, text: string): Promise<{ sent: boolean; reason?: string }> {
    if (!this.token) {
      this.logger.log(`[line skipped: channel not configured] to=${lineUserId} text="${text}"`);
      return { sent: false, reason: 'line_channel_not_configured' };
    }
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: text.slice(0, 5000) }] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`LINE push failed (${res.status}): ${body}`);
        return { sent: false, reason: `line_api_${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      this.logger.error(`LINE push failed: ${(e as Error).message}`);
      return { sent: false, reason: (e as Error).message };
    }
  }
}
