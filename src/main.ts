import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true
    }
  }));

  const kafkaConfig = configService.get('config.kafka');
  const corsOrigins = configService.get<string[]>('config.cors.origins') || [];

  if (kafkaConfig?.enabled) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: kafkaConfig.clientId,
          brokers: kafkaConfig.brokers,

        },
        consumer: {
          groupId: kafkaConfig.groupId,
        },
        producer: {
          allowAutoTopicCreation: true,
        },
      },
    });

    await app.startAllMicroservices();
    logger.log(`Kafka enabled. Brokers: ${kafkaConfig.brokers.join(', ')}`);
  } else {
    logger.warn('Kafka is disabled via ENABLE_KAFKA=false');
  }

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = configService.get('config.service.port');
  await app.listen(port);

  logger.log(`Ads microservice is running on port ${port}`);
}
bootstrap();
