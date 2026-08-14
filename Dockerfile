FROM node:22-alpine
WORKDIR /app

# Chromium is used only for PDF report export (puppeteer-core drives it headlessly).
RUN apk add --no-cache chromium
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev

COPY backend backend
COPY frontend frontend

WORKDIR /app/backend
EXPOSE 4000
CMD ["sh", "-c", "node scripts/wait-for-db.js && node scripts/migrate.js && node scripts/seed.js && node src/server.js"]
