import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthenticatedUser } from '../authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PUT: AuditAction.UPDATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

/**
 * Writes an immutable AuditLog row for every successful mutating request.
 * Read requests are not logged (would flood the trail); auth events are logged
 * explicitly by AuthService. Logging never blocks or fails the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const action = METHOD_TO_ACTION[request.method];

    return next.handle().pipe(
      tap(() => {
        if (!action) return;
        const user = request.user;
        void this.prisma.auditLog
          .create({
            data: {
              universityId: user?.universityId ?? null,
              userId: user?.id ?? null,
              action,
              entityType: request.path,
              ipAddress: request.ip ?? null,
              userAgent: request.headers['user-agent'] ?? null,
              metadata: { method: request.method, path: request.originalUrl },
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
