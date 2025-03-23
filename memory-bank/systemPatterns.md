# 시스템 패턴

## 아키텍처 개요

MCP 서버는 모듈식 아키텍처를 채택하여 명확한 책임 분리와 확장성을 제공합니다. 전체 시스템은 여러 레이어로 구성되어 있으며, 각 레이어는 특정 문제 도메인을 담당합니다.

```mermaid
flowchart TD
    A[클라이언트] --> B[API 레이어]
    B --> C[서비스 레이어]
    C --> D[파일 시스템 접근]
    C --> E[LSP 분석기]
    C --> F[임베딩 서비스]
    C --> G[데이터 액세스 레이어]
    G --> H[PostgreSQL + pgvector]

    subgraph "코어 서비스"
      C
      D
      E
      F
      G
    end
```

## 주요 컴포넌트

### 1. API 레이어 (Hono)

- REST API 엔드포인트 제공
- 요청 유효성 검사
- 응답 형식화
- 에러 처리

### 2. 서비스 레이어

- 비즈니스 로직 처리
- 의존성 주입 패턴
- 인터페이스 기반 설계

### 3. 파일 시스템 접근

- 프로젝트 파일 탐색
- 파일 내용 읽기
- 경로 보안 검증

### 4. LSP 분석기

- TypeScript 코드 구조 분석
- 심볼 추출 및 필터링
- 코드 의존성 그래프 생성

### 5. 임베딩 서비스

- OpenAI API 연동
- 코드 청크 벡터화
- 쿼리 텍스트 벡터화

### 6. 데이터 액세스 레이어

- Drizzle ORM 사용
- 타입 안전한 SQL 쿼리 구성
- 프로젝트별 필터링 지원

### 7. 데이터베이스

- PostgreSQL + pgvector
- 코드 청크 및 메타데이터 저장
- 벡터 유사도 검색

## 주요 디자인 패턴

### 의존성 주입 패턴

```typescript
// 서비스 클래스 예시
export class CodeChunkService {
  constructor(
    private symbolExtractor: SymbolExtractor,
    private codeChunkRepository: CodeChunkRepository,
    private embeddingService: EmbeddingService
  ) {}

  // 메서드...
}

// 의존성 주입 예시
const lspClient = new LspClient();
const symbolExtractor = new SymbolExtractor(lspClient);
const codeChunkRepository = new CodeChunkRepository(db);
const embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY!);

const codeChunkService = new CodeChunkService(
  symbolExtractor,
  codeChunkRepository,
  embeddingService
);
```

### 리포지토리 패턴

```typescript
// 코드 청크 리포지토리 예시
export class CodeChunkRepository {
  constructor(private db: PostgresDatabase) {}

  async findById(id: string): Promise<CodeChunk | null> {
    // 구현...
  }

  async findByProjectId(projectId: string): Promise<CodeChunk[]> {
    // 구현...
  }

  async findSimilar(
    embedding: number[],
    options: { projectId?: string; limit?: number }
  ): Promise<SearchResult[]> {
    // 구현...
  }

  // 기타 메서드...
}
```

### 서비스 인터페이스 패턴

```typescript
export interface IFileSystemService {
  listFiles(projectId: string, path: string): Promise<FileInfo[]>;
  readFile(projectId: string, path: string): Promise<string>;
}

export class FileSystemService implements IFileSystemService {
  constructor(private projectRepository: ProjectRepository) {}

  async listFiles(projectId: string, path: string): Promise<FileInfo[]> {
    // 구현...
  }

  async readFile(projectId: string, path: string): Promise<string> {
    // 구현...
  }
}
```

## LSP 통합 흐름

LSP(Language Server Protocol)를 사용하여 코드베이스에서 구조적 정보를 추출하고 코드 청크를 생성하는 전체 과정입니다.

```mermaid
sequenceDiagram
    participant API as API 엔드포인트
    participant Service as 코드 청킹 서비스
    participant LSP as LSP 클라이언트
    participant FS as 파일 시스템
    participant DB as 데이터베이스
    participant OpenAI as OpenAI API

    API->>Service: 코드 청킹 요청 (프로젝트 ID, 경로)
    Service->>FS: 파일 목록 요청
    FS-->>Service: 파일 목록 반환

    loop 각 파일
        Service->>LSP: 초기화 (프로젝트 루트 경로)
        LSP-->>Service: 초기화 완료

        Service->>FS: 파일 콘텐츠 읽기
        FS-->>Service: 파일 콘텐츠 반환

        Service->>LSP: 심볼 정보 요청
        LSP-->>Service: 심볼 정보 반환

        Service->>Service: 관련 심볼 필터링
        Service->>Service: 코드 청크 생성
        Service->>Service: 의존성 분석

        Service->>OpenAI: 임베딩 생성 요청
        OpenAI-->>Service: 임베딩 벡터 반환

        Service->>DB: 코드 청크 저장
        DB-->>Service: 저장 확인
    end

    Service->>DB: 의존성 그래프 업데이트
    DB-->>Service: 업데이트 확인

    Service-->>API: 청킹 완료 응답
```

## 코드 검색 흐름

사용자 쿼리를 기반으로 유사한 코드 청크를 검색하고 반환하는 과정입니다.

```mermaid
sequenceDiagram
    participant API as API 엔드포인트
    participant Service as 검색 서비스
    participant OpenAI as OpenAI API
    participant DB as 데이터베이스

    API->>Service: 검색 요청 (쿼리, 프로젝트 ID)
    Service->>OpenAI: 쿼리 임베딩 생성 요청
    OpenAI-->>Service: 임베딩 벡터 반환

    Service->>DB: 벡터 유사도 검색 요청
    DB-->>Service: 유사한 코드 청크 반환

    opt 의존성 그래프 요청
        Service->>DB: 의존성 그래프 조회 요청
        DB-->>Service: 의존성 및 의존자 반환
    end

    Service-->>API: 검색 결과 및 메타데이터 반환
```

## 프로젝트 관리 패턴

각 프로젝트는 독립적인 단위로 관리되며, 코드 청크는 항상 특정 프로젝트에 속합니다.

```mermaid
erDiagram
    PROJECT ||--o{ CODE_CHUNK : contains
    PROJECT {
        string id
        string name
        string path
        string description
        timestamp created_at
        timestamp updated_at
    }
    CODE_CHUNK {
        string id
        string project_id
        string path
        string code
        string type
        string name
        int line_start
        int line_end
        string[] dependencies
        string[] dependents
        vector embedding
        timestamp created_at
        timestamp updated_at
    }
```

## 데이터 모델 관계

### 프로젝트 모델

```typescript
// projects.ts
export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 코드 청크 모델

```typescript
// codeChunks.ts
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
```

## 컴포넌트 간 인터페이스

### CodeChunkRepository 인터페이스

```typescript
export interface ICodeChunkRepository {
  findById(id: string): Promise<CodeChunk | null>;
  findByProjectId(projectId: string): Promise<CodeChunk[]>;
  findByNames(names: string[], projectId: string): Promise<CodeChunk[]>;
  findSimilar(
    embedding: number[],
    options: { projectId?: string; limit?: number }
  ): Promise<SearchResult[]>;
  insertMany(codeChunks: CodeChunk[]): Promise<void>;
  update(id: string, updates: Partial<CodeChunk>): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
```

### SymbolExtractor 인터페이스

```typescript
export interface ISymbolExtractor {
  extractSymbols(filePath: string): Promise<DocumentSymbol[]>;
  filterRelevantSymbols(symbols: DocumentSymbol[]): DocumentSymbol[];
  mapSymbolKindToChunkType(
    kind: SymbolKind
  ): "function" | "class" | "type" | null;
}
```

### EmbeddingService 인터페이스

```typescript
export interface IEmbeddingService {
  generateEmbedding(text: string): Promise<number[]>;
  generateQueryEmbedding(query: string): Promise<number[]>;
}
```

## 핵심 워크플로우

### 코드 청크 생성 워크플로우

1. 프로젝트 경로에서 모든 코드 파일 스캔
2. 각 파일에 대해 LSP 서버에 심볼 정보 요청
3. 심볼 정보를 기반으로 코드 청크 생성
4. 코드 청크에서 의존성 관계 분석
5. 각 코드 청크에 대한 임베딩 생성
6. 코드 청크 및 임베딩을 데이터베이스에 저장
7. 의존성 그래프 업데이트

### 코드 검색 워크플로우

1. 사용자 쿼리 수신 (및 선택적 프로젝트 ID)
2. 쿼리 텍스트에 대한 임베딩 생성
3. 벡터 유사도 검색 수행 (프로젝트별 필터링 포함)
4. 관련 코드 청크 및 유사도 점수 반환
5. 요청 시 추가 메타데이터 (예: 의존성 그래프) 포함
