import cors from "cors";

export function createWebApiCorsMiddleware(origin: string) {
  return cors({
    origin: true,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  });
}