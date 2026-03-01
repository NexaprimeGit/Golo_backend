# Backend Deploy Guide (Railway)

This service is a NestJS app that runs:
- HTTP API (`/users`, `/ads`)
- Kafka microservice handlers (`@MessagePattern`)
- MongoDB via Mongoose

## 1) Railway Service Setup

1. Create a new Railway service from this repository.
2. Set **Root Directory** to `ads-microservice`.
3. Set build command: `pnpm build`
4. Set start command: `pnpm start:prod`
5. Set healthcheck path: `/ads/health/status`

## 2) Required Environment Variables

Set these in Railway Variables:

```env
NODE_ENV=production
SERVICE_NAME=ads-service
CORS_ORIGINS=https://choja.vercel.app
MONGODB_URI=...

ENABLE_KAFKA=true
KAFKA_BROKERS=...
KAFKA_CLIENT_ID=ads-service
KAFKA_GROUP_ID=ads-consumer-group

JWT_SECRET=...
JWT_REFRESH_SECRET=...
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
```

Notes:
- `PORT` is provided by Railway automatically.
- Keep secrets only in Railway Variables, never in committed `.env`.

## 3) Kafka Modes

- Full mode (`ENABLE_KAFKA=true`):
  - Starts HTTP + Kafka in one process.
  - Requires reachable Kafka brokers.

- API-only mode (`ENABLE_KAFKA=false`):
  - Starts HTTP API without Kafka.
  - Useful for first deploy or when Kafka is not ready.

## 4) Frontend Integration

For `Choja` frontend, set:
- `NEXT_PUBLIC_API_URL=https://<your-backend-domain>`

Also make sure backend `CORS_ORIGINS` includes your frontend origin.

## 5) Pre-Deploy Checklist

1. Use strong JWT secrets.
2. Confirm `MONGODB_URI` points to production DB.
3. Confirm Kafka broker URL is accessible from Railway (if enabled).
4. Confirm healthcheck endpoint returns 200:
   - `GET /ads/health/status`
5. Confirm login/register flow works from frontend.

## 6) Quick Smoke Tests

After deploy:

1. `GET /ads/health/status`
2. `POST /users/register`
3. `POST /users/login`
4. `GET /ads`

If Kafka enabled, also test:

1. `POST /ads/async` with JWT
2. verify service logs for Kafka connection and message processing
