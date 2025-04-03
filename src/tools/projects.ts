import { Tool } from "../types/tool";
import { CodeChunkingService } from "../services/codeChunkingService";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import * as path from "path";
import "dotenv/config";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";

const repository = CodeChunkRepository.getInstance();

// 환경 변수에서 프로젝트 ID 가져오기
const getProjectId = () => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    throw new Error("PROJECT_ID 환경 변수가 설정되지 않았습니다");
  }
  return projectId;
};

// 프로젝트 ID 설정 - 새 프로젝트 생성 후 호출 권장
const setProjectId = async (projectId: string) => {
  console.error(`새 프로젝트 ID 설정: ${projectId}`);
  process.env.PROJECT_ID = projectId;
  console.error(`환경 변수 PROJECT_ID가 ${projectId}로 설정되었습니다.`);
};

export type CreateProjectArgs = {
  name: string;
  path: string;
  description?: string;
};

export type AnalyzeProjectArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};

export type CreateChunksArgs = {
  filePath: string;
};

export type ListProjectsArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};

// 프로젝트 생성 도구
const createProject: Tool<CreateProjectArgs> = {
  name: "create_project",
  description: "새로운 프로젝트를 생성합니다",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "프로젝트 이름",
      },
      path: {
        type: "string",
        description: "프로젝트 경로",
      },
      description: {
        type: "string",
        description: "프로젝트 설명",
      },
    },
    required: ["name", "path"],
  },
  async execute(args) {
    try {
      const projectId = await repository.createProject(
        args.name,
        args.path,
        args.description
      );

      // 프로젝트 ID 설정 안내
      await setProjectId(projectId);

      return {
        content: [
          {
            type: "text",
            text: `프로젝트가 생성되었습니다.\n프로젝트 ID: ${projectId}\n\n이 ID를 사용하여 다른 명령을 실행하세요.\n환경 변수 PROJECT_ID=${projectId} 로 설정하면 이후 명령에서 자동으로 사용됩니다.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 생성 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 프로젝트 목록 조회 도구
const listProjects: Tool<ListProjectsArgs> = {
  name: "list_projects",
  description: "저장된 프로젝트 목록을 조회합니다",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    try {
      const projects = await repository.getProjects();
      const currentProjectId = getProjectId();

      const projectsText = projects
        .map(
          (p) =>
            `${p.id === currentProjectId ? "* " : ""}${p.name} (${
              p.id
            })\n   경로: ${p.path}\n   설명: ${p.description || "없음"}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `프로젝트 목록:\n\n${
              projectsText || "저장된 프로젝트가 없습니다"
            }\n\n* 현재 선택된 프로젝트`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 목록 조회 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 프로젝트 분석 도구
export const analyzeProject: Tool<AnalyzeProjectArgs> = {
  name: "analyze_project",
  description: "프로젝트의 코드를 분석하고 임베딩을 생성합니다",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    try {
      const projectId = getProjectId();

      const project = await repository.getProject(projectId);

      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      // 프로젝트 코드베이스 청킹
      const chunkingService = new CodeChunkingService(project.path, project.id);
      await chunkingService.initialize();
      const chunks = await chunkingService.chunkEntireProject();

      // 청크 저장
      await repository.saveCodeChunks(chunks);

      return {
        content: [
          {
            type: "text",
            text: `프로젝트 분석이 완료되었습니다.\n- 생성된 코드 청크: ${chunks.length}개`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 분석 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 코드 청크 생성 도구
const createChunks: Tool<CreateChunksArgs> = {
  name: "create_code_chunks",
  description: "파일의 코드를 분석하여 청크를 생성합니다",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "파일 경로",
      },
    },
    required: ["filePath"],
  },
  async execute(args) {
    try {
      const projectId = getProjectId();

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      const targetPath = path.join(project.path, args.filePath);
      if (!targetPath.startsWith(project.path)) {
        throw new Error("프로젝트 경로를 벗어난 접근입니다");
      }

      const chunkingService = new CodeChunkingService(project.path, projectId);
      await chunkingService.initialize();

      // 파일 처리 메서드 이름이 processFile이 아닌 경우 실제 메서드 이름으로 변경
      const chunks = await chunkingService.chunkFile(targetPath);

      // 청크를 DB에 삽입
      await repository.saveCodeChunks(chunks);

      return {
        content: [
          {
            type: "text",
            text: `${chunks.length}개의 코드 청크가 생성되었습니다.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "알 수 없는 오류가 발생했습니다";
      return {
        content: [
          {
            type: "text",
            text: `코드 청크 생성 중 오류가 발생했습니다: ${errorMessage}`,
          },
        ],
      };
    }
  },
};

export const projectTools = [];
