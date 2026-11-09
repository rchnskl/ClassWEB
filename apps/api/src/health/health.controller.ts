import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Liveness only: the process is up and serving. Deliberately touches no
   * database, so the platform health check and the keep-awake ping don't keep
   * the (separately billed, auto-suspending) Neon compute running around the
   * clock. Use GET /health for a readiness check that includes the database.
   */
  @Public()
  @SkipThrottle()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — no database access' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe incl. database connectivity' })
  check() {
    return this.health.check([() => this.pingDatabase()]);
  }

  private async pingDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (error) {
      return {
        database: { status: 'down', message: (error as Error).message },
      };
    }
  }
}
