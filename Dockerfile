FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/taar.db UPLOAD_DIR=/data/uploads
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
