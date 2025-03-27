import { Tool } from "../types/tool";
import { CodeChunkingService } from "../services/codeChunkingService";
import { EmbeddingService } from "../services/embeddingService";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import { CodeChunk as CodeChunkDto } from "../services/codeChunkingService";
import * as path from "path";
import * as fs from "fs/promises";
import "dotenv/config";

const repository = new CodeChunkRepository();

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

export type SearchProjectArgs = {
  query: string;
};

export type ListProjectsArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};

// 프로젝트 생성 도구
const createProject: Tool<CreateProjectArgs> = {
  name: "mcp_project_create",
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
      console.log(`프로젝트 생성 시작: ${args.name}`);
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

// 프로젝트 분석 도구
const analyzeProject: Tool<AnalyzeProjectArgs> = {
  name: "mcp_project_analyze",
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

      console.log(`프로젝트 분석 시작: ${project.name}`);

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

// 프로젝트 목록 조회 도구
const listProjects: Tool<ListProjectsArgs> = {
  name: "mcp_project_list",
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

// 프로젝트 검색 도구
const searchProject: Tool<SearchProjectArgs> = {
  name: "mcp_project_search",
  description: "프로젝트 내 코드를 키워드로 검색합니다",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "검색 키워드",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    try {
      const projectId = getProjectId();

      const repository = new CodeChunkRepository();
      const project = await repository.getProject(projectId);

      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      // 임베딩 생성
      const embeddingService = new EmbeddingService();
      const queryEmbedding = await embeddingService.generateEmbedding(
        args.query
      );

      // 벡터 검색 사용
      const chunks = await repository.searchSimilarCodeChunks(
        projectId,
        queryEmbedding,
        10
      );

      if (chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `검색 결과가 없습니다: "${args.query}"`,
            },
          ],
        };
      }

      const resultsText = chunks
        .map(
          (chunk: CodeChunkDto) =>
            `## ${chunk.name} (${chunk.type})\n파일: ${chunk.path}\n라인: ${chunk.lineStart}-${chunk.lineEnd}\n\n\`\`\`\n${chunk.code}\n\`\`\``
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `"${args.query}" 검색 결과 (${chunks.length}개):\n\n${resultsText}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 검색 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

export const projectTools = [
  createProject,
  analyzeProject,
  listProjects,
  searchProject,
];
