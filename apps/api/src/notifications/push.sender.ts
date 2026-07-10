import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Web Push (browser Push API) sender. Fully functional once VAPID_PUBLIC_KEY
 * / VAPID_PRIVATE_KEY are set (generate with `npx web-push generate-vapid-keys`);
 * otherwise it degrades gracefully. Sends to every subscription the user has
 * registered (one per browser/device) and prunes subscriptions the browser
 * reports as gone (410/404).
 */
@Injectable()
export class PushSender {
  private readonly logger = new Logger('PushSender');
  private readonly ready: boolean;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    this.ready = !!(pub && priv);
    if (this.ready) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@nursing.au.edu', pub!, priv!);
    }
  }

  get configured(): boolean {
    return this.ready;
  }

  get publicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
  }

  async send(userId: string, title: string, body: string): Promise<{ sent: boolean; reason?: string }> {
    if (!this.ready) {
      this.logger.log(`[push skipped: VAPID not configured] userId=${userId} title="${title}"`);
      return { sent: false, reason: 'vapid_not_configured' };
    }
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return { sent: false, reason: 'no_subscriptions' };

    const payload = JSON.stringify({ title, body });
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          this.logger.error(`Push send failed: ${(e as Error).message}`);
        }
      }
    }
    return sent > 0 ? { sent: true } : { sent: false, reason: 'all_subscriptions_failed' };
  }
}
