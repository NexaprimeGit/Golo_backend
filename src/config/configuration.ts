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
    port: parseInt(process.env.PORT, 10) || 3002,
  },
  
  cors: {
    origins: parseList(process.env.CORS_ORIGINS),
  },
  
  mongodb: {
    // 🔴 Make sure URI is required in production
    uri: process.env.MONGODB_URI,
  },
  
// src/config/configuration.ts
kafka: {
  enabled: parseBoolean(process.env.ENABLE_KAFKA ?? 'false'),
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : [],
  clientId: process.env.KAFKA_CLIENT_ID || 'golo-backend',
  groupId: process.env.KAFKA_GROUP_ID || 'golo-consumer-group',
  sasl: process.env.KAFKA_SASL_USERNAME ? {
    mechanism: process.env.KAFKA_SASL_MECHANISM || 'plain',
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  } : undefined,
  ssl: false,
},
  
  // 🔴 ADDED: JWT configuration (important for Railway)
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRATION || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
}));