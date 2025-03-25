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

## 코드 분석 기술

### TypeScript AST 기반 분석

- TypeScript 컴파일러 API 직접 사용
- AST 기반 코드 구조 분석
- 타입 체커를 통한 정확한 심볼 분석
- 의존성 그래프 구축

### 코드 청킹 전략

- AST 노드 기반 코드 청크 추출
- 함수, 클래스, 인터페이스, 타입 선언 분석
- 정확한 라인 번호 추적
- 상대 경로 기반 파일 관리

### 임베딩 생성

- OpenAI text-embedding-3-small 모델 사용
- 파일 경로 컨텍스트 포함
- 배치 처리 최적화
- 에러 처리 및 재시도 로직

## 개발 환경

### 컴파일러 설정

- TypeScript strict 모드
- ES2020 타겟
- Node.js 모듈 해상도
- 타입 체킹 최적화

### 의존성

- typescript: ^5.4.2
- @types/typescript: 타입 정의
- uuid: 청크 ID 생성
- OpenAI API: 임베딩 생성

## 성능 최적화

### 코드 분석

- TypeScript 프로그램 재사용
- 타입 체커 캐싱
- 병렬 처리 지원
- 메모리 사용량 최적화

### 임베딩 생성

- 배치 처리
- 병렬 요청 처리
- 에러 복구
- 재시도 메커니즘

## 데이터 모델

### 코드 청크

```typescript
interface CodeChunk {
  id: string;
  projectId: string;
  path: string;
  code: string;
  type: "function" | "class" | "type" | "constant";
  name: string;
  lineStart: number;
  lineEnd: number;
  dependencies: string[];
  dependents: string[];
  embedding?: number[] | null;
}
```

### 의존성 그래프

- 양방향 의존성 추적
- 순환 의존성 처리
- 전체 의존성 트리 분석
- 의존성 해결 및 검증

## API 사용 최적화

### OpenAI API

- 요청 배치 처리
- 에러 처리 및 재시도
- 입력 유효성 검사
- 토큰 제한 관리

### 파일 시스템

- 비동기 작업
- 디렉토리 순회 최적화
- 파일 필터링
- 에러 처리

## 에러 처리

### 분석 에러

- AST 파싱 에러 처리
- 타입 체커 에러 처리
- 의존성 해결 실패 처리
- 메모리 부족 처리

### 임베딩 에러

- API 요청 실패 처리
- 입력 검증 실패 처리
- 배치 처리 실패 복구
- 재시도 로직

## 모니터링

### 성능 메트릭

- 코드 분석 시간
- 임베딩 생성 시간
- 메모리 사용량
- API 호출 통계

### 에러 추적

- 에러 유형 분류
- 실패율 모니터링
- 재시도 성공률
- 리소스 사용량
