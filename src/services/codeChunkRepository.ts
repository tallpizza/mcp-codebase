import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CodeChunk as CodeChunkDto } from "./codeChunkingService";
import { codeChunks, projects } from "../db/schema";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import "dotenv/config";
import { sql, count } from "drizzle-orm";

// 코드 청크 저장소
export class CodeChunkRepository {
  private db: ReturnType<typeof drizzle>;
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.db = drizzle(this.pool);
  }

  // 연결 종료
  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // 모든 프로젝트 조회
  async getProjects() {
    return await this.db.select().from(projects);
  }

  // 프로젝트 생성
  async createProject(
    name: string,
    path: string,
    description?: string
  ): Promise<string> {
    const projectId = uuidv4();

    await this.db.insert(projects).values({
      id: projectId,
      name,
      path,
      description,
    });

    return projectId;
  }

  // 프로젝트 조회
  async getProject(projectId: string) {
    const result = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    return result[0] || null;
  }

  // 코드 청크 저장
  async saveCodeChunks(chunks: CodeChunkDto[]): Promise<void> {
    if (!chunks || chunks.length === 0) {
      console.log("저장할 코드 청크가 없습니다");
      return;
    }

    try {
      console.log(`${chunks.length}개의 코드 청크 저장 시작`);

      // 코드 청크 벌크 저장을 위한 값 변환
      const chunkValues = chunks.map((chunk) => ({
        id: chunk.id,
        projectId: chunk.projectId,
        path: chunk.path,
        code: chunk.code,
        type: chunk.type,
        name: chunk.name,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        dependencies: chunk.dependencies || [],
        dependents: chunk.dependents || [],
        embedding: [] as number[], // 임시 빈 배열, 나중에 임베딩 처리
      }));

      // 청크를 데이터베이스에 삽입
      const insertedChunks = await this.db
        .insert(codeChunks)
        .values(chunkValues)
        .onConflictDoUpdate({
          target: [codeChunks.projectId, codeChunks.path, codeChunks.name],
          set: {
            code: sql`excluded.code`,
            lineStart: sql`excluded.line_start`,
            lineEnd: sql`excluded.line_end`,
            updatedAt: sql`current_timestamp`,
          },
        })
        .returning();

      console.log(`${insertedChunks.length}개의 코드 청크 저장 완료`);
    } catch (error) {
      console.error("코드 청크 저장 중 오류 발생:", error);
      throw error;
    }
  }

  // 프로젝트 ID로 코드 청크 조회
  async getCodeChunksByProjectId(projectId: string): Promise<CodeChunkDto[]> {
    try {
      console.log(`프로젝트 ID ${projectId}의 코드 청크 조회 중`);

      const dbChunks = await this.db
        .select()
        .from(codeChunks)
        .where(eq(codeChunks.projectId, projectId));

      // 데이터베이스 청크를 서비스 객체로 변환
      const chunks: CodeChunkDto[] = dbChunks.map((chunk) => ({
        id: chunk.id,
        projectId: chunk.projectId,
        path: chunk.path,
        code: chunk.code,
        type: chunk.type,
        name: chunk.name,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        dependencies: chunk.dependencies || [],
        dependents: chunk.dependents || [],
      }));

      console.log(`조회된 코드 청크 수: ${chunks.length}`);
      return chunks;
    } catch (error) {
      console.error(
        `프로젝트 ID ${projectId}의 코드 청크 조회 중 오류 발생:`,
        error
      );
      throw error;
    }
  }

  // 프로젝트 ID로 코드 청크 수 조회
  async getCodeChunksCountByProjectId(projectId: string): Promise<number> {
    try {
      const result = await this.db
        .select({ count: count() })
        .from(codeChunks)
        .where(eq(codeChunks.projectId, projectId));

      return result[0]?.count || 0;
    } catch (error) {
      console.error(
        `프로젝트 ID ${projectId}의 코드 청크 수 조회 중 오류 발생:`,
        error
      );
      throw error;
    }
  }

  // 프로젝트 ID와 코드 청크 유형으로 코드 청크 조회
  async getCodeChunksByType(
    projectId: string,
    type: "function" | "class" | "type"
  ): Promise<CodeChunkDto[]> {
    try {
      console.log(`프로젝트 ID ${projectId}의 ${type} 유형 코드 청크 조회 중`);

      const dbChunks = await this.db
        .select()
        .from(codeChunks)
        .where(
          and(eq(codeChunks.projectId, projectId), eq(codeChunks.type, type))
        );

      // 데이터베이스 청크를 서비스 객체로 변환
      const chunks: CodeChunkDto[] = dbChunks.map((chunk) => ({
        id: chunk.id,
        projectId: chunk.projectId,
        path: chunk.path,
        code: chunk.code,
        type: chunk.type,
        name: chunk.name,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        dependencies: chunk.dependencies || [],
        dependents: chunk.dependents || [],
      }));

      console.log(`조회된 ${type} 유형 코드 청크 수: ${chunks.length}`);
      return chunks;
    } catch (error) {
      console.error(
        `프로젝트 ID ${projectId}의 ${type} 유형 코드 청크 조회 중 오류 발생:`,
        error
      );
      throw error;
    }
  }

  // 단일 코드 청크 조회
  async getCodeChunk(chunkId: string) {
    const result = await this.db
      .select()
      .from(codeChunks)
      .where(eq(codeChunks.id, chunkId));

    return result[0] || null;
  }

  // 프로젝트 내 코드 청크 키워드 검색
  async searchCodeChunks(projectId: string, query: string) {
    // 간단한 텍스트 검색 (나중에 벡터 검색으로 대체)
    return await this.db
      .select()
      .from(codeChunks)
      .where(eq(codeChunks.projectId, projectId));
  }
}
