import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { KafkaModule } from './kafka/kafka.module';
import { AdsModule } from './ads/ads.module';
import { UsersModule } from './users/users.module';

const logger = new Logger('MongoDB');

@Module({
  imports: [
    // Configuration - load environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // MongoDB Connection
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri = configService.get('config.mongodb.uri');
        return {
          uri: uri,
          connectionFactory: (connection) => {
            connection.on('connected', () => {
              logger.log('MongoDB connected successfully');
            });
            connection.on('error', (error) => {
              logger.error(`MongoDB connection error: ${error.message}`);
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),

    // Feature Modules - order doesn't matter with forwardRef
    KafkaModule,
    AdsModule,
    UsersModule,
  ],
})
export class AppModule { }
