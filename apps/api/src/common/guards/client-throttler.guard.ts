import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../authenticated-user';

/**
 * Rate-limit per person, not per network address.
 *
 * The stock guard keys on `req.ip`. Students reach the API from the same campus
 * Wi-Fi, so one public address stands for a whole class; and before `trust proxy`
 * was set, Render's edge made every visitor look identical, so the whole system
 * shared a single bucket. Keys here:
 *
 *  - signed-in requests → the user id (this guard runs after JwtAuthGuard);
 *  - login              → client address + the email being tried, so a class
 *                         signing in together doesn't share one allowance while
 *                         guessing one account's password is still capped;
 *  - anything else      → client address.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request & { user?: AuthenticatedUser };
    if (r.user?.id) return `user:${r.user.id}`;

    const ip = r.ip ?? 'unknown';
    const email = (r.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && r.path.endsWith('/auth/login')) {
      return `login:${ip}:${email.trim().toLowerCase()}`;
    }
    return `ip:${ip}`;
  }
}
