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
      // 인자 검증 로직 추가
      if (!args || typeof args !== "object") {
        throw new Error("유효하지 않은 인자 형식: 객체가 필요합니다");
      }

      if (!args.query || typeof args.query !== "string") {
        throw new Error("유효한 검색어(query)가 필요합니다");
      }

      // 디버깅을 위한 로깅
      console.error(
        `코드 청크 검색 시작: 쿼리="${args.query}", 제한=${
          args.limit || 10
        }, 임계값=${args.threshold || 0.3}`
      );

      const projectId = getProjectId();
      console.error(`사용 중인 프로젝트 ID: ${projectId}`);

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      // 임베딩 생성
      console.error(`임베딩 생성 시작: "${args.query}"`);
      const embeddingService = new EmbeddingService();
      const queryEmbedding = await embeddingService.generateEmbedding(
        args.query
      );
      console.error(`임베딩 생성 완료: 차원 ${queryEmbedding.length}`);

      // CodeChunkRepository 싱글톤 인스턴스 사용
      const repository = CodeChunkRepository.getInstance();

      // 코드 청크 검색
      console.error(`코드 청크 검색 시작: 프로젝트 ID=${projectId}`);
      const chunks = await repository.searchCodeChunksByCosine(
        projectId,
        queryEmbedding,
        args.limit || 10,
        args.threshold || 0.3
      );
      console.error(`검색 결과: ${chunks.length}개 청크 발견`);

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
      // 자세한 오류 정보 로깅
      const errorDetail =
        error instanceof Error
          ? `${error.message}\n${error.stack}`
          : String(error);
      console.error(`코드 청크 검색 오류: ${errorDetail}`);

      // 사용자에게 표시할 메시지
      const errorMessage =
        error instanceof Error
          ? error.message
          : "알 수 없는 오류가 발생했습니다";
      return {
        content: [
          {
            type: "text",
            text: `코드 청크 검색 중 오류가 발생했습니다: ${errorMessage} ${errorDetail}`,
          },
        ],
      };
    }
  },
};

export const codeTools = [searchChunks];
