import { forwardRef, Module } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { KafkaController } from './kafka.controller';
import { AdsModule } from '../ads/ads.module';

const kafkaEnabled = process.env.ENABLE_KAFKA === 'true';

@Module({
  imports: kafkaEnabled ? [forwardRef(() => AdsModule)] : [],
  providers: kafkaEnabled ? [KafkaService] : [],
  controllers: kafkaEnabled ? [KafkaController] : [],
  exports: kafkaEnabled ? [KafkaService] : [],
})
export class KafkaModule {}