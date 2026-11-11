import 'reflect-metadata';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Behind a reverse proxy, take the client address from X-Forwarded-For — but
  // only as many hops as there really are proxies, so a client can't spoof its
  // address by sending its own header. Rate limits and audit logs rely on it.
  const trustProxyHops = config.get<number>('trustProxyHops')!;
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  // Security headers.
  app.use(helmet());

  // CORS — explicit allow-list from config.
  // maxAge lets the browser cache each preflight: every API call carries an
  // Authorization header, so without it every request cost an extra round trip.
  app.enableCors({ origin: config.get<string[]>('cors.origins'), credentials: true, maxAge: 7200 });

  // Versioned API surface: /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Strict input validation on every DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  // OpenAPI / Swagger.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ClassWeb API')
    .setDescription('Faculty of Nursing classroom & attendance platform — REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port')!;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/api/v1 (docs: /api/docs)`);
}

void bootstrap();
