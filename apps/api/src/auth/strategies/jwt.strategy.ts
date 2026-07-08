import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/authenticated-user';
import { AccessTokenPayload } from '../token.service';

/**
 * Validates the access token and materialises the request principal, including
 * the flattened RBAC permission set resolved from the user's roles.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 'ACTIVE' },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('User is not active');

    const permissions = new Set<string>();
    const roleCodes: string[] = [];
    for (const userRole of user.roles) {
      roleCodes.push(userRole.role.code);
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }

    return {
      id: user.id,
      universityId: user.universityId,
      email: user.email,
      roleCodes,
      permissions: [...permissions],
    };
  }
}
