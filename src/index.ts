import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import projectsRouter from "./routes/projects";
import filesRouter from "./routes/files";

const app = new Hono();

// 미들웨어 설정
app.use("*", logger());
app.use("*", cors());

// 라우터 설정
app.route("/projects", projectsRouter);
app.route("/files", filesRouter);

// 기본 경로
app.get("/", (c) => {
  return c.json({
    message: "MCP API 서버에 오신 것을 환영합니다",
    version: "0.1.0",
    endpoints: {
      projects: "/projects",
      files: "/files",
    },
  });
});

export default app;
