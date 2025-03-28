import { Tool } from "../types/tool";
import { EmbeddingService } from "../services/embeddingService";
import { db } from "../db";
import { projects, codeChunks, type CodeChunk } from "../db/schema";
import { eq } from "drizzle-orm";
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

export type SearchChunksArgs = {
  query: string;
  limit?: number;
  threshold?: number;
};

export type SearchProjectArgs = {
  query: string;
};

// 코드 청크 검색 도구
const searchChunks: Tool<SearchChunksArgs> = {
  name: "search_code_chunks",
  description:
    "설정된 프로젝트 내에서 코드 청크를 임베딩 벡터를 사용하여 검색합니다",
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
      threshold: {
        type: "number",
        description: "유사도 임계값",
        default: 0.3,
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
        args.threshold || 0.3 // 유사도 임계값
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

export const codeTools = [searchChunks];
