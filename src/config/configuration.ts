import { registerAs } from '@nestjs/config';

const parseBoolean = (value?: string): boolean => {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export default registerAs('config', () => ({
  environment: process.env.NODE_ENV || 'development',
  service: {
    name: process.env.SERVICE_NAME || 'ads-service',
    port: parseInt(process.env.PORT, 10) || 3001,
  },
  cors: {
    origins: parseList(process.env.CORS_ORIGINS),
  },
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  kafka: {
    enabled: parseBoolean(process.env.ENABLE_KAFKA ?? 'true'),
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'ads-service',
    groupId: process.env.KAFKA_GROUP_ID || 'ads-consumer-group',
  },
}));
