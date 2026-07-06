import './infrastructure/bigint-json';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody: webhook signature verification needs the exact bytes received.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(config.getOrThrow<string>('API_GLOBAL_PREFIX'));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGINS').split(','),
    credentials: true,
  });

  // Validation is Zod-based via ZodValidationPipe on each route (shared
  // @fiq/contracts schemas) — no class-validator global pipe.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.get('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Football IQ Challenge API')
      .setDescription('Skill-based football prediction contests')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
