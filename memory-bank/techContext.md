# 기술 컨텍스트

## 기본 기술 스택

### 백엔드 프레임워크

- **Hono**: 경량 웹 프레임워크
  - 버전: ^4.7.5
  - 특징: 빠른 성능, 타입스크립트 지원, 미들웨어 시스템

### 런타임 환경

- **Bun**: JavaScript/TypeScript 런타임
  - 장점: 빠른 실행 속도, 내장 번들러, 패키지 매니저
  - 사용: 개발 및 프로덕션 환경

### 개발 언어

- **TypeScript**
  - 설정: `strict` 모드 사용
  - JSX 지원: Hono의 JSX 사용

### 데이터베이스

- **PostgreSQL**: 메인 데이터베이스
  - 용도: 코드 청크 및 관계 저장
  - pgvector 확장: 벡터 검색 지원
  - 인덱싱: 프로젝트별 필터링을 위한 인덱스 설정
- **Drizzle ORM**: 데이터베이스 액세스 레이어
  - TypeScript 기반 타입 안전성
  - 마이그레이션 관리

## 핵심 의존성

### 필요한 추가 패키지 (아직 미설치)

- **openai**: OpenAI API 클라이언트
  - 용도: 임베딩 생성
- **vscode-languageserver-protocol**: LSP 클라이언트
  - 용도: 코드 분석 및 심볼 추출
- **drizzle-orm**: PostgreSQL 데이터 조작
  - 용도: 타입 안전한 데이터베이스 액세스
- **postgres**: PostgreSQL 클라이언트
  - 용도: 데이터베이스 연결
- **uuid**: UUID 생성
  - 용도: 식별자 생성 (프로젝트 및 코드 청크)

## 개발 환경 설정

- **빌드 도구**: Bun (내장 번들러)
- **패키지 관리**: Bun 패키지 매니저
- **실행 명령어**: `bun run --hot src/index.ts` (개발 모드)
- **데이터베이스**: Docker로 PostgreSQL 실행

## 기술적 제약사항

1. **파일 시스템 액세스**

   - 보안 제약: 허용된 디렉토리만 접근 가능하도록 설정
   - 경로 정규화: 경로 순회 공격 방지

2. **LSP 분석**

   - 언어 지원: 초기에는 TypeScript/JavaScript만 지원
   - 성능 고려: 대규모 코드베이스 분석 시 메모리 사용량 관리
   - 대상 심볼: 함수, 클래스, 인터페이스/타입 정의에 집중

3. **임베딩 서비스**

   - API 키 관리: 안전한 환경 변수 사용
   - 요청 한도: OpenAI API 요청 제한 고려
   - 비용 관리: 임베딩 생성 횟수 최적화

4. **벡터 검색**
   - PostgreSQL pgvector 확장 사용
   - 코사인 유사도 기반 검색
   - 인덱싱 전략 최적화
   - 프로젝트별 필터링 조건 조합

## 데이터 모델

### 프로젝트 스키마

```typescript
type Project = {
  id: string; // 고유 식별자 uuid
  name: string; // 프로젝트 이름
  path: string; // 프로젝트 루트 경로
  description?: string; // 프로젝트 설명
};
```

### 코드 청크 스키마

```typescript
type CodeChunk = {
  id: string; // 고유 식별자 uuid
  projectId: string; // 프로젝트 식별자
  path: string; // 파일 경로
  code: string; // 코드 내용
  type: "function" | "class" | "type"; // 청크 유형
  name: string; // 식별자 이름
  lineStart: number; // 시작 라인
  lineEnd: number; // 종료 라인
  dependencies: string[]; // 이 코드가 사용하는 것들
  dependents: string[]; // 이 코드를 사용하는 것들
  embedding?: number[]; // 임베딩 벡터 (내부용)
};
```

## API 인터페이스 설계

### 파일 시스템 API

```
GET /fs/ls?path={path}
GET /fs/read?path={path}&offset={offset}&limit={limit}
```

### 프로젝트 API

```
GET /projects
GET /projects/:id
POST /projects
  - body: { name: string, path: string, description?: string }
DELETE /projects/:id
```

### 코드 분석 API

```
POST /code/chunk
  - body: { projectId: string, path: string, content?: string }

GET /code/search?query={query}&projectId={projectId}&limit={limit}
```

# 기술적 컨텍스트

## 사용 기술

### 서버 기술

- **Hono**: 백엔드 서버 프레임워크
- **Bun**: 자바스크립트/타입스크립트 런타임
- **TypeScript**: 타입 안전성을 위한 언어 선택

### 데이터베이스

- **PostgreSQL**: 관계형 데이터베이스
- **pgvector**: 벡터 검색 확장
- **Drizzle ORM**: 타입 안전 ORM

### 코드 분석

- **TypeScript LSP**: 코드 구조 분석
- **vscode-languageserver-protocol**: LSP 클라이언트 구현
- **typescript-language-server**: TypeScript 언어 서버

### 임베딩 및 검색

- **OpenAI API**: 코드 임베딩 생성
- **text-embedding-3-small**: 임베딩 모델

### 유틸리티

- **uuid**: 고유 식별자 생성
- **zod**: 데이터 유효성 검사

## 개발 환경

- **Bun**으로 개발 서버 실행 (`bun run --hot`)
- **Docker**로 PostgreSQL 환경 설정
- **Visual Studio Code**로 개발
- **환경 변수**는 `.env` 파일로 관리

## LSP 통합 아키텍처

### LSP 서버 연결

```typescript
import { ChildProcess, spawn } from "child_process";
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node";
import {
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver-protocol";

export class LspClient {
  private connection: MessageConnection | null = null;
  private serverProcess: ChildProcess | null = null;

  async initialize(workspacePath: string): Promise<InitializeResult> {
    // typescript-language-server 프로세스 시작
    this.serverProcess = spawn(
      "npx",
      ["typescript-language-server", "--stdio"],
      { cwd: workspacePath }
    );

    // 연결 설정
    this.connection = createMessageConnection(
      new StreamMessageReader(this.serverProcess.stdout!),
      new StreamMessageWriter(this.serverProcess.stdin!)
    );

    // 연결 시작
    this.connection.listen();

    // LSP 서버 초기화
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: `file://${workspacePath}`,
      capabilities: {
        textDocument: {
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
          synchronization: {
            dynamicRegistration: true,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          uri: `file://${workspacePath}`,
          name: "workspace",
        },
      ],
    };

    return this.connection.sendRequest("initialize", params);
  }

  // 다른 LSP 메서드들...

  async dispose(): Promise<void> {
    if (this.connection) {
      await this.connection.sendRequest("shutdown", null);
      this.connection.dispose();
      this.connection = null;
    }

    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}
```

### 심볼 추출 기능

```typescript
import {
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolKind,
} from "vscode-languageserver-protocol";

export class SymbolExtractor {
  private lspClient: LspClient;

  constructor(lspClient: LspClient) {
    this.lspClient = lspClient;
  }

  /**
   * 파일에서 모든 심볼을 추출
   */
  async extractSymbols(filePath: string): Promise<DocumentSymbol[]> {
    const params: DocumentSymbolParams = {
      textDocument: {
        uri: `file://${filePath}`,
      },
    };

    try {
      const symbols = await this.lspClient.connection!.sendRequest(
        "textDocument/documentSymbol",
        params
      );
      return symbols as DocumentSymbol[];
    } catch (error) {
      console.error(`Failed to extract symbols from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * 심볼 종류를 CodeChunk 타입으로 변환
   */
  mapSymbolKindToChunkType(
    kind: SymbolKind
  ): "function" | "class" | "type" | null {
    switch (kind) {
      case SymbolKind.Function:
      case SymbolKind.Method:
        return "function";
      case SymbolKind.Class:
        return "class";
      case SymbolKind.Interface:
      case SymbolKind.TypeParameter:
      case SymbolKind.Enum:
        return "type";
      default:
        return null;
    }
  }

  /**
   * 지원되는 심볼 필터링 (함수, 클래스, 인터페이스/타입만)
   */
  filterRelevantSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
    const relevantKinds = [
      SymbolKind.Function,
      SymbolKind.Method,
      SymbolKind.Class,
      SymbolKind.Interface,
      SymbolKind.TypeParameter,
      SymbolKind.Enum,
    ];

    const result: DocumentSymbol[] = [];

    // 심볼 트리 재귀적으로 탐색
    const processSymbol = (symbol: DocumentSymbol) => {
      if (relevantKinds.includes(symbol.kind)) {
        result.push(symbol);
      }

      if (symbol.children) {
        for (const child of symbol.children) {
          processSymbol(child);
        }
      }
    };

    for (const symbol of symbols) {
      processSymbol(symbol);
    }

    return result;
  }
}
```

## 코드 청킹 아키텍처

### 코드 청크 서비스

```typescript
import { readFile } from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { DocumentSymbol } from "vscode-languageserver-protocol";
import { SymbolExtractor } from "./symbolExtractor";
import { CodeChunkRepository } from "../db/repositories/codeChunkRepository";
import { EmbeddingService } from "./embeddingService";

export interface CodeChunk {
  id: string;
  projectId: string;
  path: string;
  code: string;
  type: "function" | "class" | "type";
  name: string;
  lineStart: number;
  lineEnd: number;
  dependencies: string[];
  dependents: string[];
  embedding?: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class CodeChunkService {
  private symbolExtractor: SymbolExtractor;
  private codeChunkRepository: CodeChunkRepository;
  private embeddingService: EmbeddingService;

  constructor(
    symbolExtractor: SymbolExtractor,
    codeChunkRepository: CodeChunkRepository,
    embeddingService: EmbeddingService
  ) {
    this.symbolExtractor = symbolExtractor;
    this.codeChunkRepository = codeChunkRepository;
    this.embeddingService = embeddingService;
  }

  /**
   * 파일에서 코드 청크 추출
   */
  async extractCodeChunks(
    projectId: string,
    filePath: string
  ): Promise<CodeChunk[]> {
    try {
      // 파일 내용 읽기
      const fileContent = await readFile(filePath, "utf-8");
      const lines = fileContent.split("\n");

      // 심볼 추출
      const symbols = await this.symbolExtractor.extractSymbols(filePath);
      const relevantSymbols =
        this.symbolExtractor.filterRelevantSymbols(symbols);

      // 심볼로부터 코드 청크 생성
      const codeChunks: CodeChunk[] = [];
      for (const symbol of relevantSymbols) {
        const type = this.symbolExtractor.mapSymbolKindToChunkType(symbol.kind);
        if (!type) continue;

        // 코드 추출 (라인 기준)
        const startLine = symbol.range.start.line;
        const endLine = symbol.range.end.line;
        const codeLines = lines.slice(startLine, endLine + 1);
        const code = codeLines.join("\n");

        // 의존성 분석 (정규식 기반)
        const dependencies = this.analyzeDependencies(code);

        const codeChunk: CodeChunk = {
          id: uuidv4(),
          projectId,
          path: filePath,
          code,
          type,
          name: symbol.name,
          lineStart: startLine,
          lineEnd: endLine,
          dependencies,
          dependents: [],
        };

        codeChunks.push(codeChunk);
      }

      // 임베딩 생성
      for (const chunk of codeChunks) {
        const embedding = await this.embeddingService.generateEmbedding(
          this.preprocessCodeForEmbedding(chunk.code)
        );
        chunk.embedding = embedding;
      }

      return codeChunks;
    } catch (error) {
      console.error(`Failed to extract code chunks from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * 코드에서 의존성 분석 (간단한 정규식 기반)
   */
  private analyzeDependencies(code: string): string[] {
    const dependencies: string[] = [];

    // import 문 분석
    const importRegex =
      /import\s+(?:{([^}]+)}|([^\s;]+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(code)) !== null) {
      // 중괄호 내부의 여러 항목
      if (match[1]) {
        const imports = match[1]
          .split(",")
          .map((s) => s.trim().split(" as ")[0].trim());
        dependencies.push(...imports);
      }
      // 단일 import (예: import React from 'react')
      else if (match[2]) {
        dependencies.push(match[2].trim());
      }
    }

    // require 문 분석
    const requireRegex =
      /const\s+(?:{([^}]+)}|([^\s=]+))\s+=\s+require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(code)) !== null) {
      if (match[1]) {
        const imports = match[1]
          .split(",")
          .map((s) => s.trim().split(":")[0].trim());
        dependencies.push(...imports);
      } else if (match[2]) {
        dependencies.push(match[2].trim());
      }
    }

    return [...new Set(dependencies)]; // 중복 제거
  }

  /**
   * 임베딩을 위한 코드 전처리
   */
  private preprocessCodeForEmbedding(code: string): string {
    // 주석 제거
    code = code.replace(/\/\/.*$/gm, "");
    code = code.replace(/\/\*[\s\S]*?\*\//g, "");

    // 연속된 공백 제거
    code = code.replace(/\s+/g, " ");

    // 앞뒤 공백 제거
    code = code.trim();

    return code;
  }

  /**
   * 코드 청크 저장
   */
  async saveCodeChunks(codeChunks: CodeChunk[]): Promise<void> {
    await this.codeChunkRepository.insertMany(codeChunks);
  }

  /**
   * 의존성 관계 업데이트
   */
  async updateDependencyGraph(projectId: string): Promise<void> {
    // 프로젝트 내 모든 코드 청크 가져오기
    const allChunks = await this.codeChunkRepository.findByProjectId(projectId);

    // 이름별로 청크 맵 생성
    const chunkMap = new Map<string, CodeChunk>();
    allChunks.forEach((chunk) => {
      chunkMap.set(chunk.name, chunk);
    });

    // 각 청크의 dependents 배열 초기화
    allChunks.forEach((chunk) => {
      chunk.dependents = [];
    });

    // 의존성에 따라 dependents 업데이트
    allChunks.forEach((chunk) => {
      chunk.dependencies.forEach((depName) => {
        const depChunk = chunkMap.get(depName);
        if (depChunk && !depChunk.dependents.includes(chunk.name)) {
          depChunk.dependents.push(chunk.name);
        }
      });
    });

    // 업데이트된 청크 저장
    for (const chunk of allChunks) {
      await this.codeChunkRepository.update(chunk.id, {
        dependents: chunk.dependents,
      });
    }
  }
}
```

## 임베딩 서비스 아키텍처

```typescript
import OpenAI from "openai";

export class EmbeddingService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey,
    });
  }

  /**
   * 코드 청크를 위한 임베딩 생성
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Failed to generate embedding:", error);
      throw error;
    }
  }

  /**
   * 쿼리 텍스트를 위한 임베딩 생성
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query);
  }
}
```

## 코드 검색 서비스 아키텍처

```typescript
import { CodeChunkRepository } from "../db/repositories/codeChunkRepository";
import { EmbeddingService } from "./embeddingService";

export interface SearchResult {
  codeChunk: CodeChunk;
  similarity: number;
}

export class CodeSearchService {
  private codeChunkRepository: CodeChunkRepository;
  private embeddingService: EmbeddingService;

  constructor(
    codeChunkRepository: CodeChunkRepository,
    embeddingService: EmbeddingService
  ) {
    this.codeChunkRepository = codeChunkRepository;
    this.embeddingService = embeddingService;
  }

  /**
   * 유사도 기반 코드 청크 검색
   */
  async searchSimilarCode(
    query: string,
    projectId?: string,
    limit = 10
  ): Promise<SearchResult[]> {
    // 쿼리 임베딩 생성
    const queryEmbedding = await this.embeddingService.generateQueryEmbedding(
      query
    );

    // 벡터 유사도 검색 수행
    const results = await this.codeChunkRepository.findSimilar(queryEmbedding, {
      projectId,
      limit,
    });

    return results;
  }

  /**
   * 특정 코드 청크의 의존성 그래프 조회
   */
  async getDependencyGraph(
    chunkId: string,
    depth = 1
  ): Promise<{
    chunk: CodeChunk;
    dependencies: CodeChunk[];
    dependents: CodeChunk[];
  }> {
    // 코드 청크 조회
    const chunk = await this.codeChunkRepository.findById(chunkId);
    if (!chunk) {
      throw new Error(`Code chunk with id ${chunkId} not found`);
    }

    // 의존성 조회
    const dependencies = await this.codeChunkRepository.findByNames(
      chunk.dependencies,
      chunk.projectId
    );

    // 의존자 조회
    const dependents = await this.codeChunkRepository.findByNames(
      chunk.dependents,
      chunk.projectId
    );

    return {
      chunk,
      dependencies,
      dependents,
    };
  }
}
```

## 기술적 제약 사항

- Node.js 파일 시스템 API를 통한 파일 접근 제한
- PostgreSQL의 pgvector 확장 설치 필요
- LSP 서버 프로세스 관리 및 리소스 사용 최적화 필요
- OpenAI API 키 필요 및 API 사용 제한/비용 고려
- 프로젝트 경로는 서버에서 접근 가능해야 함
- 많은 수의 코드 청크를 효율적으로 관리하기 위한 인덱싱 필요

## 의존성

### 기본 패키지

```json
{
  "dependencies": {
    "@hono/node-server": "^1.2.0",
    "drizzle-orm": "^0.28.6",
    "hono": "^3.7.2",
    "openai": "^4.12.1",
    "pg": "^8.11.3",
    "postgres": "^3.4.0",
    "typescript-language-server": "^3.3.2",
    "uuid": "^9.0.1",
    "vscode-languageserver-protocol": "^3.17.3",
    "zod": "^3.22.2"
  },
  "devDependencies": {
    "@types/node": "^20.8.2",
    "@types/pg": "^8.10.3",
    "@types/uuid": "^9.0.4",
    "bun-types": "^1.0.6",
    "drizzle-kit": "^0.19.13",
    "typescript": "^5.2.2"
  }
}
```

## 코드 청킹 전략

### 파일 경로 처리

- 프로젝트 루트 기준 상대 경로 사용
- 데이터베이스에는 상대 경로만 저장
- 임베딩 생성 시 파일 경로 포함하여 문맥 제공

### 코드 청크 추출

- TypeScript AST 기반 코드 분석
- 함수, 클래스, 인터페이스, 타입 선언 추출
- 정확한 라인 번호 추적 (1-based indexing)
- 의존성 관계 분석 및 양방향 매핑

### 임베딩 생성

- OpenAI text-embedding-3-small 모델 사용
- 배치 처리로 성능 최적화 (최대 300개 단위)
- 코드 전처리:
  - 주석 제거
  - 공백 정규화
  - 파일 경로 정보 포함
  - 최대 길이 제한 (8000자)
- 병렬 처리로 대량 임베딩 생성

### 에러 처리

- 빈 문자열 및 유효하지 않은 입력 필터링
- 임베딩 생성 실패 시 안전한 에러 처리
- 디렉토리 순회 중 발생하는 오류 격리

## 데이터 모델

### 코드 청크 스키마

```typescript
interface CodeChunk {
  id: string;
  projectId: string;
  path: string; // 프로젝트 루트 기준 상대 경로
  code: string;
  type: "function" | "class" | "type" | "constant";
  name: string;
  lineStart: number; // 1-based
  lineEnd: number; // 1-based
  dependencies: string[];
  dependents: string[];
  embedding?: number[] | null;
}
```

## 서비스 아키텍처

### EmbeddingService

```typescript
class EmbeddingService {
  private batchSize: number = 300;

  preprocessCodeForEmbedding(code: string, filePath?: string): string {
    // 코드 전처리 및 파일 경로 포함
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // 배치 단위 병렬 처리
  }
}
```

### CodeChunkingService

```typescript
class CodeChunkingService {
  private projectRoot: string;
  private projectId: string;

  async extractCodeChunksFromFile(filePath: string): Promise<CodeChunk[]> {
    // 상대 경로 변환
    // AST 기반 코드 분석
    // 청크 추출 및 임베딩 생성
  }
}
```

## 성능 최적화

1. **배치 처리**

   - 임베딩 생성을 300개 단위로 배치 처리
   - Promise.all을 사용한 병렬 처리

2. **메모리 관리**

   - 대용량 코드 처리를 위한 청크 단위 처리
   - 텍스트 길이 제한으로 메모리 사용량 관리

3. **에러 복구**
   - 개별 파일 처리 실패 시 전체 프로세스 유지
   - 실패한 항목 로깅 및 건너뛰기

## API 사용량 최적화

1. **OpenAI API**

   - 배치 처리로 API 호출 최소화
   - 입력 데이터 전처리로 불필요한 요청 방지
   - 에러 발생 시 재시도 로직 구현 예정

2. **파일 시스템**
   - 필요한 파일만 선택적으로 처리
   - node_modules, .git 등 불필요한 디렉토리 제외
