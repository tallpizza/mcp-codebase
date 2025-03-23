import { Hono } from "hono";
import * as fs from "fs/promises";
import * as path from "path";

const filesRouter = new Hono();

// 디렉토리 목록 조회
filesRouter.get("/list", async (c) => {
  try {
    const { dir } = c.req.query();

    if (!dir) {
      return c.json(
        { success: false, error: "디렉토리 경로가 필요합니다" },
        400
      );
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    const files = entries.map((entry) => {
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dir, entry.name),
      };
    });

    return c.json({ success: true, data: { files, count: files.length } });
  } catch (error) {
    console.error("디렉토리 목록 조회 실패:", error);
    return c.json(
      { success: false, error: "디렉토리 목록 조회에 실패했습니다" },
      500
    );
  }
});

// 파일 내용 조회
filesRouter.get("/read", async (c) => {
  try {
    const { path: filePath } = c.req.query();

    if (!filePath) {
      return c.json({ success: false, error: "파일 경로가 필요합니다" }, 400);
    }

    const content = await fs.readFile(filePath, "utf-8");

    return c.json({
      success: true,
      data: {
        path: filePath,
        content,
        size: content.length,
      },
    });
  } catch (error) {
    console.error("파일 내용 조회 실패:", error);
    return c.json(
      { success: false, error: "파일 내용 조회에 실패했습니다" },
      500
    );
  }
});

export default filesRouter;
