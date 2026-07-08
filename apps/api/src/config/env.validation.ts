import { plainToInstance } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

/**
 * Fail-fast environment validation. The app refuses to boot with a missing or
 * weak secret — no silent insecure defaults in production.
 */
class EnvironmentVariables {
  @IsOptional() @IsString()
  PORT?: string;

  @IsOptional() @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsNotEmpty() @IsString()
  DATABASE_URL!: string;

  @IsNotEmpty() @MinLength(16, { message: 'JWT_ACCESS_SECRET must be at least 16 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsNotEmpty() @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters' })
  JWT_REFRESH_SECRET!: string;

  @IsOptional() @IsString()
  JWT_ACCESS_TTL?: string;

  @IsOptional() @IsString()
  JWT_REFRESH_TTL?: string;

  @IsOptional() @IsString()
  CORS_ORIGINS?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }
  return validated;
}
