import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

/** jsonwebtoken's `expiresIn` uses the `ms` StringValue type; config gives us a string. */
type ExpiresIn = JwtSignOptions['expiresIn'];
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  universityId: string;
  email: string;
}

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  /** Session-anchor time (epoch seconds): when this login session first began.
   *  Carried unchanged through every rotation so the absolute cap can be enforced. */
  sat: number;
}

/** Absolute session lifetime: a session may not be refreshed past this, regardless of activity. */
const ABSOLUTE_SESSION_MS = 3 * 60 * 60 * 1000;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Issues access/refresh tokens and manages refresh-token rotation.
 * Only a SHA-256 hash of each refresh token is persisted — never the token.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueTokens(
    user: { id: string; universityId: string; email: string },
    ctx: RequestContext = {},
    /** Preserve the original session-anchor time across rotations; a fresh login omits it (defaults to now). */
    sat?: number,
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get<string>('jwt.accessTtl')!;
    const refreshTtl = this.config.get<string>('jwt.refreshTtl')!;

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      universityId: user.universityId,
      email: user.email,
    };
    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, sat: sat ?? Math.floor(Date.now() / 1000) };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: accessTtl as ExpiresIn,
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: refreshTtl as ExpiresIn,
    });

    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: accessTtl };
  }

  /** Verifies + rotates a refresh token. Throws if invalid, expired or revoked. */
  async rotate(refreshToken: string, ctx: RequestContext = {}): Promise<IssuedTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    // Absolute session cap: enforced here on the server so a tampered client clock
    // cannot extend a session beyond ABSOLUTE_SESSION_MS from its original anchor.
    const anchorMs = (payload.sat ?? Math.floor(stored.createdAt.getTime() / 1000)) * 1000;
    if (Date.now() - anchorMs >= ABSOLUTE_SESSION_MS) {
      await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user) throw new UnauthorizedException('User is not active');

    // Rotate: revoke the presented token, then issue a fresh pair — keeping the original anchor.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user, ctx, payload.sat);
  }

  /** Revokes a single refresh token (logout). Idempotent. */
  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session for a user — used on password change/reset. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
