import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/** Prisma constraint violations are user-fixable input problems, not server faults. */
const PRISMA_STATUS: Record<string, { status: HttpStatus; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'That value is already in use.' },
  P2003: { status: HttpStatus.CONFLICT, message: 'This record is still referenced by other data and cannot be changed or removed.' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found.' },
};

/**
 * Uniform error envelope. Hides internal error details in production while
 * preserving HttpException messages (validation, auth, etc.).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const prisma =
      exception instanceof Prisma.PrismaClientKnownRequestError ? PRISMA_STATUS[exception.code] : undefined;

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : prisma?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown = 'Internal server error';
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as { message?: unknown }).message ?? res;
    } else if (exception instanceof Error) {
      if (prisma) message = prisma.message;
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
