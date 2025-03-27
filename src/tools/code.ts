import { Tool } from "../types/tool";
import { CodeChunkingService } from "../services/codeChunkingService";
import { EmbeddingService } from "../services/embeddingService";
import { db } from "../db";
import { projects, codeChunks, type CodeChunk } from "../db/schema";
import { eq } from "drizzle-orm";
import * as path from "path";
import * as fs from "fs/promises";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import { CodeChunk as CodeChunkDto } from "../services/codeChunkingService";

// 환경 변수에서 프로젝트 ID 가져오기
const getProjectId = () => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    throw new Error("PROJECT_ID 환경 변수가 설정되지 않았습니다");
  }
  return projectId;
};

export type GetChunkStatsArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};
export type SearchChunksArgs = {
  query: string;
  limit?: number;
};

export type SearchProjectArgs = {
  query: string;
};

// 프로젝트 검색 도구
const searchChunksByKeyword: Tool<SearchProjectArgs> = {
  name: "keyword_search",
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

      // 벡터 검색 사용
      const chunks = await repository.searchCodeChunks(projectId, args.query);

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

// 코드 청크 검색 도구
const searchChunks: Tool<SearchChunksArgs> = {
  name: "search_code_chunks",
  description: "코드 청크를 검색합니다",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "검색어",
      },
      limit: {
        type: "number",
        description: "검색 결과 제한",
        default: 10,
      },
    },
    required: ["query"],
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

      // 임베딩 생성
      const embeddingService = new EmbeddingService();
      const queryEmbedding = await embeddingService.generateEmbedding(
        args.query
      );

      // CodeChunkRepository를 사용한 벡터 검색
      const repository = new CodeChunkRepository();
      const chunks = await repository.searchCodeChunksByCosine(
        projectId,
        queryEmbedding,
        args.limit || 10,
        0.3 // 유사도 임계값
      );

      // similarity 속성이 있음을 명시적으로 표현
      interface CodeChunkWithSimilarity extends CodeChunkDto {
        similarity?: number;
      }

      return {
        content: chunks.map((chunk: CodeChunkWithSimilarity) => ({
          type: "text",
          text: `파일: ${chunk.path}\n시작 줄: ${chunk.lineStart}\n종료 줄: ${
            chunk.lineEnd
          }\n유사도: ${chunk.similarity?.toFixed(2) || "N/A"}\n\n${chunk.code}`,
        })),
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
            text: `코드 청크 검색 중 오류가 발생했습니다: ${errorMessage}`,
          },
        ],
      };
    }
  },
};

// 코드 청크 통계 도구
const getChunkStats: Tool<GetChunkStatsArgs> = {
  name: "mcp_code_getStats",
  description: "프로젝트의 코드 청크 통계를 반환합니다",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
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

      // 청크 통계 계산
      const chunks = await db
        .select()
        .from(codeChunks)
        .where(eq(codeChunks.projectId, projectId));

      const uniqueFiles = new Set(chunks.map((chunk) => chunk.path)).size;
      const chunkSizes = chunks.map(
        (chunk) => chunk.lineEnd - chunk.lineStart + 1
      );

      const stats = {
        totalChunks: chunks.length,
        totalFiles: uniqueFiles,
        averageChunkSize:
          chunkSizes.length > 0
            ? chunkSizes.reduce((sum, size) => sum + size, 0) /
              chunkSizes.length
            : 0,
        largestChunk: chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0,
        smallestChunk: chunkSizes.length > 0 ? Math.min(...chunkSizes) : 0,
      };

      return {
        content: [
          {
            type: "text",
            text:
              `프로젝트 통계:\n` +
              `- 총 청크 수: ${stats.totalChunks}\n` +
              `- 총 파일 수: ${stats.totalFiles}\n` +
              `- 평균 청크 크기: ${stats.averageChunkSize.toFixed(2)} 줄\n` +
              `- 가장 큰 청크: ${stats.largestChunk} 줄\n` +
              `- 가장 작은 청크: ${stats.smallestChunk} 줄`,
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
            text: `통계 조회 중 오류가 발생했습니다: ${errorMessage}`,
          },
        ],
      };
    }
  },
};

export const codeTools = [searchChunksByKeyword, searchChunks, getChunkStats];
