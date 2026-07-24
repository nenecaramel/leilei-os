import cors from "cors";

export function createWebApiCorsMiddleware(origin: string) {
  return cors({
    origin,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  });
}