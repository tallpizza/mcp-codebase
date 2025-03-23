/**
 * API 타입 정의 파일
 *
 * 이 파일은 API 요청 및 응답에 사용되는 타입 정의를 포함합니다.
 */

// 파일 정보 인터페이스
export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}

// 프로젝트 정보 인터페이스
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// 코드 청크 기본 정보 인터페이스
export interface CodeChunkInfo {
  id: string;
  projectId: string;
  path: string;
  name: string;
  type: "function" | "class" | "type";
  lineStart: number;
  lineEnd: number;
}

// 코드 청크 상세 정보 인터페이스
export interface CodeChunkDetail extends CodeChunkInfo {
  code: string;
  dependencies: string[];
  dependents: string[];
}

// 코드 검색 결과 인터페이스
export interface CodeSearchResult {
  chunks: CodeChunkInfo[];
  total: number;
  page: number;
  pageSize: number;
}

// API 응답 기본 인터페이스
export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
}
