import cors from "cors";

export function createWebApiCorsMiddleware(_origin: string) {
  return cors({
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  });
}