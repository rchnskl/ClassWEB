import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IssuedTokens, TokenService } from './token.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginResult extends IssuedTokens {
  user: { id: string; email: string; universityId: string; roleCodes: string[] };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: LoginDto, ctx: RequestContext = {}): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        deletedAt: null,
        ...(dto.universityCode ? { university: { code: dto.universityCode } } : {}),
      },
      include: { roles: { include: { role: true } } },
    });

    // Constant-ish work whether or not the user exists (avoid user enumeration).
    const hash = user?.passwordHash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
    const passwordOk = await bcrypt.compare(dto.password, hash);

    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.tokenService.issueTokens(user, ctx);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        universityId: user.universityId,
        userId: user.id,
        action: AuditAction.LOGIN,
        entityType: 'User',
        entityId: user.id,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        universityId: user.universityId,
        roleCodes: user.roles.map((r) => r.role.code),
      },
    };
  }

  async refresh(refreshToken: string, ctx: RequestContext = {}): Promise<IssuedTokens> {
    return this.tokenService.rotate(refreshToken, ctx);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user?.passwordHash) throw new UnauthorizedException('Account not found');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokenService.revokeAllForUser(userId);
    await this.prisma.auditLog.create({
      data: { universityId: user.universityId, userId, action: AuditAction.UPDATE, entityType: 'User', entityId: userId, metadata: { action: 'password_change' } },
    });
  }

  /** Re-verify the current user's password to unlock an idle-locked session. Issues no new tokens. */
  async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    const hash = user?.passwordHash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Password is incorrect');
    }
  }

  async logout(refreshToken: string, userId?: string, ctx: RequestContext = {}): Promise<void> {
    await this.tokenService.revoke(refreshToken);
    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: AuditAction.LOGOUT,
          entityType: 'User',
          entityId: userId,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });
    }
  }
}
