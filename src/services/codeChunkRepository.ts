import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CodeChunk as CodeChunkDto } from "./codeChunkingService";
import { codeChunks, projects } from "../db/schema";
import { v4 as uuidv4 } from "uuid";
import {
  eq,
  and,
  sql,
  gt,
  desc,
  asc,
  getTableColumns,
  cosineDistance,
} from "drizzle-orm";
import "dotenv/config";
import { count } from "drizzle-orm";

// 코드 청크 저장소
export class CodeChunkRepository {
  private static instance: CodeChunkRepository | null = null; // 싱글톤 인스턴스
  private db: ReturnType<typeof drizzle>;
  private pool: Pool;

  // 생성자를 private으로 변경
  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.db = drizzle(this.pool);
    // 데이터베이스 초기화 (예: pgvector 확장 생성)는 별도 메서드로 호출 필요
    // 예: this.initializeDatabase();
  }

  // 싱글톤 인스턴스 반환 메서드
  public static getInstance(): CodeChunkRepository {
    if (!CodeChunkRepository.instance) {
      CodeChunkRepository.instance = new CodeChunkRepository();
    }
    return CodeChunkRepository.instance;
  }

  // 연결 종료
  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // DB 초기화 메서드 (외부에서 호출 가능하도록 public으로)
  public async initializeDatabase(): Promise<void> {
    try {
      await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
    } catch (error) {
      console.error("데이터베이스 초기화 중 오류 발생:", error);
      throw error;
    }
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

  // 프로젝트의 마지막 커밋 해시 업데이트
  async updateProjectCommitHash(
    projectId: string,
    commitHash: string
  ): Promise<void> {
    try {
      await this.db
        .update(projects)
        .set({
          lastCommitHash: commitHash,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));
    } catch (error) {
      console.error(
        `프로젝트 ${projectId}의 커밋 해시 업데이트 중 오류 발생:`,
        error
      );
      throw error;
    }
  }

  // 코드 청크 저장
  async saveCodeChunks(chunks: CodeChunkDto[]): Promise<void> {
    if (!chunks || chunks.length === 0) {
      return;
    }

    try {
      // 중복 청크 제거 (projectId + path + name 조합이 동일한 경우)
      const uniqueChunks = this.deduplicateChunks(chunks);

      if (chunks.length !== uniqueChunks.length) {
      }

      // 코드 청크 벌크 저장을 위한 값 변환
      const chunkValues = uniqueChunks.map((chunk) => ({
        id: uuidv4(),
        projectId: chunk.projectId,
        path: chunk.path,
        code: chunk.code,
        type: chunk.type,
        name: chunk.name,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        dependencies: chunk.dependencies || [],
        dependents: chunk.dependents || [],
        embedding: chunk.embedding || null, // 임베딩이 없으면 null 사용
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
            embedding: sql`excluded.embedding`,
            dependencies: sql`excluded.dependencies`,
            dependents: sql`excluded.dependents`,
            updatedAt: sql`current_timestamp`,
          },
        })
        .returning();
    } catch (error) {
      console.error("코드 청크 저장 중 오류 발생:", error);
      throw error;
    }
  }

  // 중복 청크 제거 함수
  private deduplicateChunks(chunks: CodeChunkDto[]): CodeChunkDto[] {
    const uniqueMap = new Map<string, CodeChunkDto>();

    for (const chunk of chunks) {
      // 고유 키 생성 (projectId + path + name)
      const uniqueKey = `${chunk.projectId}-${chunk.path}-${chunk.name}`;

      // 중복이 발견되지 않았거나, 기존 청크보다 더 최신 정보를 가진 경우 맵에 추가
      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, chunk);
      } else {
      }
    }

    return Array.from(uniqueMap.values());
  }

  // 프로젝트 ID로 코드 청크 조회
  async getCodeChunksByProjectId(projectId: string): Promise<CodeChunkDto[]> {
    try {
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

  // 임베딩을 사용한 코드 청크 유사도 검색 (코사인 유사도 사용)
  async searchCodeChunksByCosine(
    projectId: string,
    embedding: number[],
    limit: number = 10,
    threshold: number = 0.3
  ): Promise<CodeChunkDto[]> {
    try {
      // 코사인 유사도 계산
      const similarity = sql<number>`1 - (${cosineDistance(
        codeChunks.embedding,
        embedding
      )})`;

      // ORM 방식으로 쿼리 작성
      const results = await this.db
        .select({
          id: codeChunks.id,
          projectId: codeChunks.projectId,
          path: codeChunks.path,
          code: codeChunks.code,
          type: codeChunks.type,
          name: codeChunks.name,
          lineStart: codeChunks.lineStart,
          lineEnd: codeChunks.lineEnd,
          dependencies: codeChunks.dependencies,
          dependents: codeChunks.dependents,
          similarity: similarity,
        })
        .from(codeChunks)
        .where(
          and(
            eq(codeChunks.projectId, projectId),
            sql`${codeChunks.embedding} IS NOT NULL`,
            gt(similarity, threshold)
          )
        )
        .orderBy(desc(similarity))
        .limit(limit);

      // 조회 결과를 DTO로 변환 (이미 적절한 속성 이름으로 선택됨)
      const chunks: CodeChunkDto[] = results.map((chunk) => ({
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
        similarity: chunk.similarity,
      }));

      return chunks;
    } catch (error) {
      console.error(
        `프로젝트 ID ${projectId}의 코사인 유사도 기반 코드 청크 검색 중 오류 발생:`,
        error
      );
      throw error;
    }
  }

  // 프로젝트 내 코드 청크 키워드 검색
  async searchCodeChunks(projectId: string, query: string, limit: number = 10) {
    try {
      // 간단한 텍스트 검색 (코드 내용에 키워드가 포함된 경우)
      const results = await this.db
        .select()
        .from(codeChunks)
        .where(
          and(
            eq(codeChunks.projectId, projectId),
            sql`${codeChunks.code} ILIKE ${`%${query}%`}`
          )
        )
        .limit(limit);

      // 조회 결과를 DTO로 변환
      const chunks: CodeChunkDto[] = results.map((chunk) => ({
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

      return chunks;
    } catch (error) {
      console.error(
        `프로젝트 ID ${projectId}의 코드 청크 키워드 검색 중 오류 발생:`,
        error
      );
      throw error;
    }
  }
}
