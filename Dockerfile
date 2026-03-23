FROM oven/bun:1
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY prisma ./prisma
RUN bunx prisma generate
COPY . .
# Create uploads directory — configure as Docker volume in Coolify for persistence
RUN mkdir -p /app/uploads
VOLUME /app/uploads
EXPOSE 3000
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss && bun run src/index.ts"]
