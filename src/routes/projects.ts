import { Hono } from "hono";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import { CodeChunkingService } from "../services/codeChunkingService";
import { z } from "zod";
import * as path from "path";

const projectsRouter = new Hono();
const repository = new CodeChunkRepository();

// 프로젝트 생성 스키마
const createProjectSchema = z.object({
  path: z.string().min(1, "프로젝트 경로는 필수입니다"),
  name: z.string().optional(),
  description: z.string().optional(),
});

// 프로젝트 목록 조회
projectsRouter.get("/", async (c) => {
  try {
    const projects = await repository.getProjects();
    return c.json({ success: true, data: projects });
  } catch (error) {
    console.error("프로젝트 목록 조회 실패:", error);
    return c.json(
      { success: false, error: "프로젝트 목록 조회에 실패했습니다" },
      500
    );
  }
});

// 프로젝트 생성
projectsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const validationResult = createProjectSchema.safeParse(body);

    if (!validationResult.success) {
      return c.json(
        { success: false, error: validationResult.error.errors },
        400
      );
    }

    let { path: projectPath, name, description } = validationResult.data;

    // 경로의 마지막 폴더 이름을 프로젝트 이름으로 사용
    if (!name) {
      name = path.basename(projectPath);
    }

    const projectId = await repository.createProject(
      name,
      projectPath,
      description
    );

    return c.json(
      {
        success: true,
        data: { id: projectId, name, path: projectPath, description },
      },
      201
    );
  } catch (error) {
    console.error("프로젝트 생성 실패:", error);
    return c.json(
      { success: false, error: "프로젝트 생성에 실패했습니다" },
      500
    );
  }
});

// 프로젝트 상세 조회
projectsRouter.get("/:id", async (c) => {
  try {
    const projectId = c.req.param("id");
    const project = await repository.getProject(projectId);

    if (!project) {
      return c.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다" },
        404
      );
    }

    return c.json({ success: true, data: project });
  } catch (error) {
    console.error("프로젝트 조회 실패:", error);
    return c.json(
      { success: false, error: "프로젝트 조회에 실패했습니다" },
      500
    );
  }
});

// 프로젝트 코드 청킹 시작 (전체 프로젝트)
projectsRouter.post("/:id/chunk", async (c) => {
  try {
    const projectId = c.req.param("id");
    const project = await repository.getProject(projectId);

    if (!project) {
      return c.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다" },
        404
      );
    }

    // 코드 청킹 서비스 생성
    const chunkingService = new CodeChunkingService(project.path, project.id);

    try {
      // LSP 클라이언트 초기화
      await chunkingService.initialize();

      // 프로젝트 청킹 실행
      const chunks = await chunkingService.chunkEntireProject();

      // 청크가 생성된 경우에만 저장 진행
      if (chunks.length > 0) {
        await repository.saveCodeChunks(chunks);
      }

      return c.json({
        success: true,
        data: {
          message: "코드 청킹이 완료되었습니다",
          chunksCount: chunks.length,
        },
      });
    } catch (error: unknown) {
      console.error("코드 청킹 중 오류 발생:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return c.json(
        {
          success: false,
          error: `코드 청킹 중 오류가 발생했습니다: ${errorMessage}`,
          details: String(error),
        },
        500
      );
    } finally {
      // 청킹 서비스 종료
      try {
        await chunkingService.shutdown();
      } catch (shutdownError) {
        console.error("청킹 서비스 종료 중 오류:", shutdownError);
      }
    }
  } catch (error) {
    console.error("프로젝트 코드 청킹 실패:", error);
    return c.json(
      {
        success: false,
        error: "프로젝트 코드 청킹에 실패했습니다",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// 특정 디렉토리 코드 청킹
projectsRouter.post("/:id/chunk/directory", async (c) => {
  try {
    const projectId = c.req.param("id");
    const body = await c.req.json();
    const { directory } = body;

    if (!directory) {
      return c.json(
        { success: false, error: "디렉토리 경로는 필수입니다" },
        400
      );
    }

    const project = await repository.getProject(projectId);

    if (!project) {
      return c.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다" },
        404
      );
    }

    // 코드 청킹 서비스 생성
    const chunkingService = new CodeChunkingService(project.path, project.id);

    try {
      // LSP 클라이언트 초기화
      await chunkingService.initialize();

      // 특정 디렉토리 청킹 실행
      const chunks = await chunkingService.chunkDirectory(directory);

      // 청크가 생성된 경우에만 저장 진행
      if (chunks.length > 0) {
        await repository.saveCodeChunks(chunks);
      }

      return c.json({
        success: true,
        data: {
          message: "디렉토리 코드 청킹이 완료되었습니다",
          directory,
          chunksCount: chunks.length,
        },
      });
    } catch (error: unknown) {
      console.error("디렉토리 코드 청킹 중 오류 발생:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return c.json(
        {
          success: false,
          error: `디렉토리 코드 청킹 중 오류가 발생했습니다: ${errorMessage}`,
          details: String(error),
        },
        500
      );
    } finally {
      // 청킹 서비스 종료
      try {
        await chunkingService.shutdown();
      } catch (shutdownError) {
        console.error("청킹 서비스 종료 중 오류:", shutdownError);
      }
    }
  } catch (error) {
    console.error("디렉토리 코드 청킹 실패:", error);
    return c.json(
      {
        success: false,
        error: "디렉토리 코드 청킹에 실패했습니다",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// 프로젝트 코드 청크 조회
projectsRouter.get("/:id/chunks", async (c) => {
  try {
    const projectId = c.req.param("id");
    const project = await repository.getProject(projectId);

    if (!project) {
      return c.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다" },
        404
      );
    }

    const chunks = await repository.getCodeChunksByProjectId(projectId);

    return c.json({
      success: true,
      data: {
        chunks,
        count: chunks.length,
        projectId,
      },
    });
  } catch (error) {
    console.error("프로젝트 코드 청크 조회 실패:", error);
    return c.json(
      { success: false, error: "프로젝트 코드 청크 조회에 실패했습니다" },
      500
    );
  }
});

export default projectsRouter;
