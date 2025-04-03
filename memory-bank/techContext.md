# 기술 컨텍스트

## 사용된 기술

### 백엔드 런타임

- **Node.js**: 16.x 이상
- **Bun**: 1.x - 빠른 실행 및 번들링

### 데이터베이스

- **PostgreSQL**: 15.x
- **pgvector**: 벡터 검색 확장

### 프로토콜 및 통신

- **MCP(Model Context Protocol)**: Claude와의 통신
- **stdio**: 기본 전송 계층

### 임베딩

- **OpenAI Embeddings API**: Ada 002 모델
- **pgvector**: 벡터 저장 및 코사인 유사도 검색

### 코드 분석

- **자체 구현 파서**: 파일 시스템 접근 및 코드 분석
- **AST 파싱**: 필요한 경우 코드 구조 분석
- **청킹 알고리즘**: 코드 청크 분할 및 처리

### 버전 관리

- **Git**: 소스 제어 및 변경 추적
- **커밋 해시 추적**: 변경된 파일 감지

### CLI 인터페이스

- **명령어 파서**: 인자 처리 및 검증
- **커맨드 패턴**: 클린한 명령어 구현
- **도움말 생성**: 자동 사용법 문서 생성

### ORM

- **Drizzle ORM**: 타입 안전 쿼리 생성
- **마이그레이션**: 스키마 변경 관리

## 개발 설정

### 패키지 관리자

- **npm/yarn**: 패키지 의존성 관리
- **Bun**: 패키지 설치 및 스크립트 실행

### 타입스크립트 설정

- **strict 모드**: 정적 타입 검사 강화
- **ESNext 타겟**: 최신 JS 기능 활용

### 테스트

- **Jest/Vitest**: 단위 테스트
- **테스트 자동화**: CI/CD 통합 계획

## 기술적 제약

### 임베딩 API

- OpenAI API 키 필요
- 요청 속도 제한

### 데이터베이스

- PostgreSQL 15+ 필요
- pgvector 확장 설치 필요
- 벡터 인덱스 성능 최적화 필요

### Git 통합

- Git CLI 의존성
- Git 저장소 접근 권한

## 기술 의존성

```
dependencies:
  - "drizzle-orm": PostgreSQL ORM
  - "openai": OpenAI API 클라이언트
  - "pg": PostgreSQL 클라이언트
  - "nanoid": ID 생성
  - "glob": 파일 패턴 매칭
  - "dotenv": 환경 변수 로딩
  - "commander": CLI 명령어 파싱
```

## 데이터 흐름

### 프로젝트 생성 흐름

```mermaid
sequenceDiagram
    참가자 User as 사용자
    참가자 CLI as CLI 인터페이스
    참가자 PS as 프로젝트 서비스
    참가자 Git as Git 서비스
    참가자 Repo as 코드 청크 리포지토리
    참가자 DB as 데이터베이스

    User->>CLI: create-project 명령
    CLI->>PS: createProject 호출
    PS->>Git: isGitRepository 호출
    Git-->>PS: Git 저장소 확인 결과

    alt Git 저장소 아님
        PS-->>CLI: 오류: Git 저장소가 아님
        CLI-->>User: 오류 메시지 표시
    else Git 저장소임
        PS->>Git: getCurrentCommitHash 호출
        Git-->>PS: 현재 커밋 해시
        PS->>Repo: createProject 호출
        Repo->>DB: 프로젝트 데이터 저장
        DB-->>Repo: 저장 결과
        Repo-->>PS: 생성된 프로젝트
        PS-->>CLI: 성공 결과
        CLI-->>User: 프로젝트 ID 표시
    end
```

### 검색 흐름

```mermaid
sequenceDiagram
    참가자 Client as MCP 클라이언트
    참가자 Server as MCP 서버
    참가자 Tool as 코드 도구
    참가자 Service as 코드 서비스
    참가자 Repo as 코드 청크 리포지토리
    참가자 Git as Git 서비스
    참가자 DB as 데이터베이스

    Client->>Server: 코드 검색 요청
    Server->>Tool: 도구 호출
    Tool->>Service: 검색 서비스 호출
    Service->>Git: 커밋 변경 확인
    Git-->>Service: 변경된 파일 목록

    alt 변경된 파일 있음
        Service->>Service: 변경된 파일 재분석
        Service->>Repo: 새 코드 청크 저장
        Repo->>DB: 청크 저장
        Repo-->>Service: 저장 완료
        Service->>Git: 마지막 분석 커밋 업데이트
        Git->>Repo: 커밋 해시 저장
        Repo->>DB: 해시 업데이트
        DB-->>Repo: 업데이트 완료
        Repo-->>Git: 저장 완료
    end

    Service->>Repo: 코드 청크 검색
    Repo->>DB: 벡터 검색 쿼리
    DB-->>Repo: 검색 결과
    Repo-->>Service: 검색 결과 변환
    Service-->>Tool: 포맷된 결과
    Tool-->>Server: 결과 반환
    Server-->>Client: 검색 결과
```

## 시스템 요구사항

### 하드웨어

- 최소 4GB RAM
- 2 CPU 코어
- 코드베이스 크기에 따른 충분한 디스크 공간

### 소프트웨어

- Node.js 16.x 이상 또는 Bun 1.x
- PostgreSQL 15.x + pgvector
- Git CLI

## 배포 아키텍처

### 로컬 개발

```
[개발자 환경] -> [MCP 코드베이스] -> [로컬 PostgreSQL]
```

### 자체 호스팅

```
[서버] -> [MCP 코드베이스] -> [PostgreSQL 서버] -> [OpenAI API]
```

## API 및 서비스 인터페이스

### 프로젝트 서비스

```typescript
interface ProjectService {
  createProject(params: CreateProjectParams): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
  analyzeProject(projectId: string, refresh?: boolean): Promise<AnalysisResult>;
  updateProjectCommitHash(projectId: string, hash: string): Promise<void>;
}
```

### Git 서비스

```typescript
interface GitService {
  isGitRepository(path: string): Promise<boolean>;
  getCurrentCommitHash(path: string): Promise<string>;
  getChangedFiles(path: string, since: string): Promise<string[]>;
  updateLastAnalyzedCommit(projectId: string, hash: string): Promise<void>;
}
```

### 코드 청크 리포지토리

```typescript
interface CodeChunkRepository {
  createProject(project: Project): Promise<Project>;
  getProjectById(id: string): Promise<Project | null>;
  getAllProjects(): Promise<Project[]>;
  saveCodeChunk(chunk: CodeChunk): Promise<void>;
  searchCodeChunks(query: string, projectId: string): Promise<CodeChunk[]>;
  updateProjectCommitHash(projectId: string, hash: string): Promise<void>;
}
```

## 기술적 결정 사항

### Drizzle ORM 선택

- 타입 안전성 강화
- 성능 최적화
- 스키마 마이그레이션 지원

### OpenAI Embeddings

- 고품질 코드 임베딩
- 다양한 언어 지원
- 선제적 문맥 이해

### PostgreSQL + pgvector

- 벡터 검색 최적화
- 트랜잭션 지원
- ACID 속성

### Bun 런타임

- 빠른 시작 및 실행
- TypeScript 기본 지원
- npm 패키지 호환성

### Git 통합

- 로컬 Git 저장소 지원
- 커밋 해시 기반 변경 감지
- 선택적 파일 재분석
