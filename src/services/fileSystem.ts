import * as fs from "fs/promises";
import * as path from "path";
import * as glob from "glob";
import { FileInfo } from "../models/apiTypes";

export interface FileSystemResult {
  success: boolean;
  error?: string;
  data?: any;
}

export class FileSystemService {
  private projectRoot: string;
  private fileCache: Map<string, { content: string; timestamp: number }> =
    new Map();
  private MAX_CACHE_AGE = 30000; // 30초 캐시 유효 시간
  private MAX_CACHE_SIZE = 100; // 최대 캐시 항목 수

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // 상대 경로를 절대 경로로 변환
  private resolvePath(relativePath: string): string {
    // 경로 검증 및 정규화
    const normalizedPath = path
      .normalize(relativePath)
      .replace(/^(\.\.(\/|\\|$))+/, "");
    return path.resolve(this.projectRoot, normalizedPath);
  }

  // 파일 콘텐츠 읽기 (캐싱 적용)
  async readFile(filePath: string): Promise<FileSystemResult> {
    try {
      const fullPath = this.resolvePath(filePath);

      // 파일이 프로젝트 루트 내에 있는지 확인
      if (!fullPath.startsWith(this.projectRoot)) {
        return {
          success: false,
          error: "경로가 프로젝트 루트를 벗어납니다",
        };
      }

      // 캐시에서 확인
      const now = Date.now();
      const cachedData = this.fileCache.get(fullPath);

      if (cachedData && now - cachedData.timestamp < this.MAX_CACHE_AGE) {
        // 유효한 캐시가 있으면 사용
        return {
          success: true,
          data: cachedData.content,
        };
      }

      // 파일 읽기
      const content = await fs.readFile(fullPath, "utf-8");

      // 캐시 관리 (크기 초과 시 가장 오래된 항목 제거)
      if (this.fileCache.size >= this.MAX_CACHE_SIZE) {
        const oldestEntry = Array.from(this.fileCache.entries()).sort(
          (a, b) => a[1].timestamp - b[1].timestamp
        )[0];

        if (oldestEntry) {
          this.fileCache.delete(oldestEntry[0]);
        }
      }

      // 캐시에 저장
      this.fileCache.set(fullPath, { content, timestamp: now });

      return {
        success: true,
        data: content,
      };
    } catch (error) {
      console.error(`파일 읽기 오류: ${filePath}`, error);
      return {
        success: false,
        error: `파일을 읽을 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 파일 작성
  async writeFile(
    filePath: string,
    content: string
  ): Promise<FileSystemResult> {
    try {
      const fullPath = this.resolvePath(filePath);

      // 파일이 프로젝트 루트 내에 있는지 확인
      if (!fullPath.startsWith(this.projectRoot)) {
        return {
          success: false,
          error: "경로가 프로젝트 루트를 벗어납니다",
        };
      }

      // 디렉토리 확인 및 생성
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });

      // 파일 작성
      await fs.writeFile(fullPath, content);

      // 캐시 갱신
      this.fileCache.set(fullPath, {
        content,
        timestamp: Date.now(),
      });

      return {
        success: true,
      };
    } catch (error) {
      console.error(`파일 작성 오류: ${filePath}`, error);
      return {
        success: false,
        error: `파일을 작성할 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 파일 삭제
  async deleteFile(filePath: string): Promise<FileSystemResult> {
    try {
      const fullPath = this.resolvePath(filePath);

      // 파일이 프로젝트 루트 내에 있는지 확인
      if (!fullPath.startsWith(this.projectRoot)) {
        return {
          success: false,
          error: "경로가 프로젝트 루트를 벗어납니다",
        };
      }

      await fs.unlink(fullPath);

      // 캐시에서 제거
      this.fileCache.delete(fullPath);

      return {
        success: true,
      };
    } catch (error) {
      console.error(`파일 삭제 오류: ${filePath}`, error);
      return {
        success: false,
        error: `파일을 삭제할 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 파일 목록 조회
  async listFiles(
    dirPath: string,
    pattern?: string
  ): Promise<FileSystemResult> {
    try {
      const fullPath = this.resolvePath(dirPath);

      // 경로가 프로젝트 루트 내에 있는지 확인
      if (!fullPath.startsWith(this.projectRoot)) {
        return {
          success: false,
          error: "경로가 프로젝트 루트를 벗어납니다",
        };
      }

      // 파일을 찾을 패턴 (기본값은 전체 파일)
      const globPattern = pattern || "**/*";

      // glob을 사용하여 파일 검색
      const files = await glob.glob(path.join(fullPath, globPattern), {
        ignore: ["**/node_modules/**", "**/.git/**"],
        nodir: true,
      });

      // 파일 정보 수집
      const fileInfoPromises = files.map(async (file: string) => {
        try {
          const stat = await fs.stat(file);
          const relativePath = path.relative(this.projectRoot, file);

          return {
            path: relativePath,
            name: path.basename(file),
            isDirectory: stat.isDirectory(),
            size: stat.size,
            modifiedTime: stat.mtime.toISOString(),
          } as FileInfo;
        } catch (err) {
          console.warn(`파일 정보 조회 오류 (무시됨): ${file}`, err);
          return null;
        }
      });

      const fileInfos = (await Promise.all(fileInfoPromises)).filter(
        (info: FileInfo | null): info is FileInfo => info !== null
      );

      return {
        success: true,
        data: fileInfos,
      };
    } catch (error) {
      console.error(`파일 목록 조회 오류: ${dirPath}`, error);
      return {
        success: false,
        error: `파일 목록을 조회할 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 캐시 무효화
  invalidateCache(filePath?: string): void {
    if (filePath) {
      // 특정 파일만 무효화
      const fullPath = this.resolvePath(filePath);
      this.fileCache.delete(fullPath);
    } else {
      // 전체 캐시 무효화
      this.fileCache.clear();
    }
  }

  // 캐시 상태 정보 반환 (디버깅용)
  getCacheStats(): { size: number; items: { path: string; age: number }[] } {
    const now = Date.now();
    const items = Array.from(this.fileCache.entries()).map(([path, data]) => ({
      path,
      age: now - data.timestamp,
    }));

    return {
      size: this.fileCache.size,
      items,
    };
  }
}
