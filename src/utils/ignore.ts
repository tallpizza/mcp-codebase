/**
 * 파일 무시 기능을 제공하는 유틸리티
 *
 * 이 파일은 프로젝트에서 무시해야 할 파일들을 판별하는 기능을 제공합니다.
 */

import * as path from "path";

// 기본적으로 무시할 디렉토리와 파일 패턴
const DEFAULT_IGNORE_PATTERNS = [
  // 디렉토리
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  // 파일
  ".DS_Store",
  "*.log",
  "*.lock",
  "*.min.js",
  "*.min.css",
  "*.map",
];

// 파일이나 경로가 무시 패턴에 해당하는지 확인
export function fileIsIgnored(
  filePath: string,
  ignorePatterns = DEFAULT_IGNORE_PATTERNS
): boolean {
  // 상대 경로로 변환 (필요한 경우)
  const normalizedPath = filePath.replace(/\\/g, "/");
  const fileName = path.basename(normalizedPath);

  for (const pattern of ignorePatterns) {
    // 디렉토리 패턴 (node_modules 등)
    if (!pattern.includes("*") && !pattern.startsWith(".")) {
      if (
        normalizedPath.includes(`/${pattern}/`) ||
        normalizedPath.endsWith(`/${pattern}`)
      ) {
        return true;
      }
    }
    // 와일드 카드 패턴 (*.log 등)
    else if (pattern.includes("*")) {
      const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);

      if (regex.test(fileName)) {
        return true;
      }
    }
    // 파일 패턴 (.DS_Store 등)
    else {
      if (fileName === pattern) {
        return true;
      }
    }
  }

  return false;
}

// 특정 디렉토리가 무시되어야 하는지 확인
export function directoryIsIgnored(
  dirPath: string,
  ignorePatterns = DEFAULT_IGNORE_PATTERNS
): boolean {
  const normalizedPath = dirPath.replace(/\\/g, "/");
  const dirName = path.basename(normalizedPath);

  for (const pattern of ignorePatterns) {
    // 디렉토리 패턴만 체크
    if (!pattern.includes("*") && !pattern.startsWith(".")) {
      if (dirName === pattern) {
        return true;
      }
    }
  }

  return false;
}

// .gitignore 패턴 기반 무시 기능 추가 (향후 구현)
export function parseGitignore(gitignorePath: string): string[] {
  // 향후 .gitignore 파일 파싱 기능 구현
  return [];
}
