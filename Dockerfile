FROM node:20-alpine
WORKDIR /app
COPY bot/package.json bot/package-lock.json* ./
RUN npm install --omit=dev
COPY bot/bot.js ./
ENV NODE_ENV=production
# Polling mode — no webhook, no public domain needed.
CMD ["node", "bot.js"]
