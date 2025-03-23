import * as path from "path";
import * as fs from "fs/promises";
import { SymbolInformation } from "vscode-languageserver-protocol";
import { LspClient } from "./lspClient";
import { v4 as uuidv4 } from "uuid";
import { EmbeddingService } from "./embeddingService";

// 코드 청크 인터페이스
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
  embedding?: number[] | null;
}

// 코드 청킹 서비스
export class CodeChunkingService {
  private lspClient: LspClient;
  private projectRoot: string;
  private projectId: string;
  private embeddingService: EmbeddingService;

  constructor(projectRoot: string, projectId: string, apiKey?: string) {
    this.projectRoot = projectRoot;
    this.projectId = projectId;
    this.lspClient = new LspClient(projectRoot);
    this.embeddingService = new EmbeddingService(apiKey);
  }

  // 서비스 초기화
  async initialize(): Promise<void> {
    await this.lspClient.start();
  }

  // 서비스 종료
  async shutdown(): Promise<void> {
    await this.lspClient.stop();
  }

  // 파일 내용 읽기
  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      console.error(`파일 읽기 오류 (${filePath}):`, error);
      throw error;
    }
  }

  // 코드 청크의 코드 내용 추출
  private extractCodeForSymbol(
    fileContent: string,
    symbolInfo: SymbolInformation
  ): string {
    const lines = fileContent.split("\n");
    const startLine = symbolInfo.location.range.start.line;
    const endLine = symbolInfo.location.range.end.line;

    return lines.slice(startLine, endLine + 1).join("\n");
  }

  // 파일에서 코드 청크 추출
  private async extractCodeChunksFromFile(
    filePath: string
  ): Promise<CodeChunk[]> {
    try {
      // 파일 내용 읽기
      const content = await fs.readFile(filePath, "utf-8");

      // 심볼 정보 가져오기
      const symbols = await this.lspClient.getSymbols(filePath);

      if (!symbols || symbols.length === 0) {
        return [];
      }

      console.log(
        `파일 심볼 추출: ${filePath} - ${symbols.length}개 심볼 발견`
      );

      const chunks: CodeChunk[] = [];

      // 파일 내용을 라인 단위로 분리
      const lines = content.split("\n");

      // 함수, 클래스, 타입과 같은 관련 심볼만 필터링
      const relevantSymbols = symbols.filter((symbol) => {
        // 심볼 종류 (SymbolKind enum 기준)
        const kind = symbol.kind;

        // 함수(12), 메서드(6), 클래스(5), 인터페이스(11), 타입 별칭(26)만 선택
        return (
          kind === 5 || kind === 6 || kind === 11 || kind === 12 || kind === 26
        );
      });

      console.log(
        `관련 심볼 필터링: ${symbols.length}개 -> ${relevantSymbols.length}개`
      );

      // 각 심볼에서 코드 청크 생성
      for (const symbol of relevantSymbols) {
        // 심볼 위치 정보
        const startLine = symbol.location.range.start.line;
        const endLine = symbol.location.range.end.line;

        // 해당 범위의 코드 추출
        const codeLines = lines.slice(startLine, endLine + 1);
        const code = codeLines.join("\n");

        // 청크 타입 결정
        let type: "function" | "class" | "type";
        switch (symbol.kind) {
          case 5: // 클래스
            type = "class";
            break;
          case 6: // 메서드
          case 12: // 함수
            type = "function";
            break;
          case 11: // 인터페이스
          case 26: // 타입 별칭
            type = "type";
            break;
          default:
            continue; // 지원되지 않는 심볼 종류는 건너뜀
        }

        // 의존성 분석
        const dependencies = this.analyzeDependencies(code);

        // 코드 청크 생성
        const chunk: CodeChunk = {
          id: uuidv4(),
          projectId: this.projectId,
          path: filePath,
          code,
          type,
          name: symbol.name,
          lineStart: startLine,
          lineEnd: endLine,
          dependencies,
          dependents: [], // 의존성 그래프 구축 시 업데이트됨
          embedding: null,
        };

        chunks.push(chunk);
      }

      console.log(`코드 청크 생성 완료: ${filePath} - ${chunks.length}개 청크`);

      // 생성된 청크에 대한 의존 관계 분석
      this.analyzeDependencyGraph(chunks);

      return chunks;
    } catch (error) {
      console.error(`파일 코드 청크 추출 오류 (${filePath}):`, error);
      throw error;
    }
  }

  // 코드에서 의존성 분석
  private analyzeDependencies(code: string): string[] {
    const dependencies: string[] = [];

    try {
      // 1. import 문 분석
      const importRegex =
        /import\s+(?:(?:{([^}]+)})|(?:(\w+)))\s+from\s+['"][^'"]+['"]/g;
      let match;

      while ((match = importRegex.exec(code)) !== null) {
        if (match[1]) {
          // 중괄호 내 가져오기 항목 (예: import { useState, useEffect } from 'react')
          const imports = match[1]
            .split(",")
            .map((i) => i.trim().split(" as ")[0].trim());
          dependencies.push(...imports);
        } else if (match[2]) {
          // 기본 가져오기 (예: import React from 'react')
          dependencies.push(match[2]);
        }
      }

      // 2. 클래스 확장 분석
      const extendsRegex = /class\s+\w+\s+extends\s+(\w+)/g;
      while ((match = extendsRegex.exec(code)) !== null) {
        if (match[1]) {
          dependencies.push(match[1]);
        }
      }

      // 3. 인터페이스 확장 분석
      const interfaceRegex = /interface\s+\w+\s+extends\s+([^{]+)/g;
      while ((match = interfaceRegex.exec(code)) !== null) {
        if (match[1]) {
          const interfaces = match[1].split(",").map((i) => i.trim());
          dependencies.push(...interfaces);
        }
      }

      // 4. 타입 참조 분석
      const typeRegex = /:\s*(\w+)(?:<[^>]*>)?/g;
      while ((match = typeRegex.exec(code)) !== null) {
        if (
          match[1] &&
          ![
            "string",
            "number",
            "boolean",
            "any",
            "void",
            "null",
            "undefined",
          ].includes(match[1])
        ) {
          dependencies.push(match[1]);
        }
      }

      // 5. 중복 제거 및 정리
      return Array.from(new Set(dependencies));
    } catch (err) {
      console.error("의존성 분석 중 오류:", err);
      return dependencies;
    }
  }

  // 청크 간 의존성 그래프 구축
  private analyzeDependencyGraph(chunks: CodeChunk[]): void {
    try {
      // 이름으로 청크를 찾을 수 있도록 맵 구성
      const chunkMap = new Map<string, CodeChunk>();
      chunks.forEach((chunk) => {
        chunkMap.set(chunk.name, chunk);
      });

      // 각 청크의 의존성을 확인하고 의존성 청크의 dependents 배열에 현재 청크 추가
      chunks.forEach((chunk) => {
        chunk.dependencies.forEach((depName) => {
          const depChunk = chunkMap.get(depName);
          if (depChunk && !depChunk.dependents.includes(chunk.name)) {
            depChunk.dependents.push(chunk.name);
          }
        });
      });

      console.log(`의존성 그래프 구축 완료: ${chunks.length}개 청크`);
    } catch (error) {
      console.error("의존성 그래프 구축 중 오류:", error);
    }
  }

  // 파일 내용 분석하여 코드가 있는지 확인
  private analyzeFileForCode(fileContent: string, filePath: string): boolean {
    // 빈 파일 체크
    if (!fileContent || fileContent.trim().length === 0) {
      return false;
    }

    // 주석이나 공백만 있는지 체크
    const nonCommentNonEmptyLines = fileContent.split("\n").filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("*/")
      );
    });

    if (nonCommentNonEmptyLines.length < 2) {
      console.log(`파일이 주석이나 공백만 포함: ${filePath}`);
      return false;
    }

    // 실제 코드 존재 여부 체크
    const hasImports = /import\s+.+\s+from\s+/.test(fileContent);
    const hasExports = /export\s+/.test(fileContent);
    const hasClass = /class\s+\w+/.test(fileContent);
    const hasFunction =
      /function\s+\w+/.test(fileContent) ||
      /const\s+\w+\s*=\s*(\(.*\)|async\s*\(.*\))\s*=>/.test(fileContent) ||
      /\w+\s*\(.*\)\s*{/.test(fileContent);
    const hasInterface = /interface\s+\w+/.test(fileContent);
    const hasType = /type\s+\w+\s*=/.test(fileContent);
    const hasVariable =
      /const\s+\w+\s*=/.test(fileContent) || /let\s+\w+\s*=/.test(fileContent);

    const hasCode =
      hasImports ||
      hasExports ||
      hasClass ||
      hasFunction ||
      hasInterface ||
      hasType ||
      hasVariable;

    if (!hasCode) {
      console.log(`코드가 발견되지 않음: ${filePath}`);
      return false;
    }

    return true;
  }

  // 파일에 확실히 코드가 있는지 엄격하게 확인
  private hasDefiniteCode(fileContent: string): boolean {
    // 키워드와 패턴을 포함하는 라인 카운트
    const codePatterns = [
      /class\s+\w+/,
      /function\s+\w+/,
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /export\s+(const|let|function|class|interface|type)/,
      /const\s+\w+\s*=\s*(\(.*\)|async\s*\(.*\))\s*=>/,
      /\w+\s*\(.*\)\s*{/,
    ];

    const lines = fileContent.split("\n");
    let codeLineCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/")
      ) {
        continue;
      }

      for (const pattern of codePatterns) {
        if (pattern.test(trimmed)) {
          codeLineCount++;
          break;
        }
      }
    }

    // 3개 이상의 코드 라인이 있으면 확실한 코드로 간주
    return codeLineCount >= 3;
  }

  // 프로젝트 전체 코드 청킹
  async chunkEntireProject(): Promise<CodeChunk[]> {
    return this.chunkDirectory(this.projectRoot);
  }

  // 디렉토리 내의 모든 파일 코드 청킹 (병렬 처리)
  async chunkDirectory(directoryPath: string): Promise<CodeChunk[]> {
    const absolutePath = path.isAbsolute(directoryPath)
      ? directoryPath
      : path.join(this.projectRoot, directoryPath);

    console.log(`디렉토리 청킹 시작: ${absolutePath}`);

    // 해당 디렉토리 내의 모든 TS/JS 파일 찾기
    const tsFiles = await this.findTsFilesInDirectory(absolutePath);
    console.log(`디렉토리 청킹: 총 ${tsFiles.length} 파일 처리 예정`);

    if (tsFiles.length === 0) {
      console.log("처리할 파일이 없습니다.");
      return [];
    }

    // 처리 결과 추적용 변수
    let processedFiles = 0;
    let failedFiles = 0;

    // 파일별 처리를 Promise 배열로 변환하여 병렬 처리
    const chunkPromises = tsFiles.map(async (file) => {
      try {
        console.log(`처리 중: ${file}`);
        const fileChunks = await this.extractCodeChunksFromFile(file);

        processedFiles++;
        if (fileChunks.length > 0) {
          console.log(`성공: ${file} - ${fileChunks.length}개 청크 추출`);
        } else {
          console.log(`주의: ${file} - 추출된 청크 없음`);
        }

        return fileChunks;
      } catch (error) {
        console.error(`오류: ${file} 청킹 실패:`, error);
        failedFiles++;
        // 개별 파일 오류가 전체 프로세스를 중단시키지 않도록 빈 배열 반환
        return [] as CodeChunk[];
      }
    });

    // 모든 파일 처리 결과를 병렬로 기다림
    const chunksArrays = await Promise.all(chunkPromises);

    // 모든 청크 결과 병합
    let allChunks: CodeChunk[] = chunksArrays.flat();

    console.log(
      `디렉토리 청킹 완료: 총 ${tsFiles.length}개 파일 중 ${processedFiles}개 성공, ${failedFiles}개 실패, ${allChunks.length}개 코드 청크 추출`
    );

    // 코드 청크에 대한 임베딩 배치 생성
    if (allChunks.length > 0) {
      await this.generateEmbeddingsForChunks(allChunks);
    }

    return allChunks;
  }

  // 코드 청크에 대한 임베딩 생성 (배치 처리)
  private async generateEmbeddingsForChunks(
    chunks: CodeChunk[]
  ): Promise<void> {
    try {
      console.log(`${chunks.length}개 코드 청크에 대한 임베딩 생성 시작`);

      // 전처리된 코드 준비
      const preprocessedCodes = chunks.map((chunk) =>
        this.embeddingService.preprocessCodeForEmbedding(chunk.code)
      );

      // 배치로 임베딩 생성 (내부적으로 병렬 처리됨)
      const embeddings = await this.embeddingService.generateBatchEmbeddings(
        preprocessedCodes
      );

      // 각 청크에 임베딩 할당
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = embeddings[i];
      }

      console.log(`${chunks.length}개 코드 청크의 임베딩 생성 완료`);
    } catch (error) {
      console.error("코드 청크 임베딩 생성 중 오류:", error);
      throw error;
    }
  }

  // 특정 디렉토리에서 모든 TypeScript/JavaScript 파일 찾기
  async findTsFilesInDirectory(directoryPath: string): Promise<string[]> {
    const result: string[] = [];
    console.log(`디렉토리: ${directoryPath}에서 파일 검색 시작`);

    const findTsFiles = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // node_modules, .git 등 제외
            if (
              entry.name !== "node_modules" &&
              entry.name !== ".git" &&
              entry.name !== "dist" &&
              entry.name !== "build"
            ) {
              await findTsFiles(fullPath);
            }
          } else if (
            entry.isFile() &&
            (entry.name.endsWith(".ts") ||
              entry.name.endsWith(".tsx") ||
              entry.name.endsWith(".js") ||
              entry.name.endsWith(".jsx"))
          ) {
            result.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`디렉토리 읽기 오류 (${dir}):`, error);
      }
    };

    await findTsFiles(directoryPath);
    console.log(`찾은 TS/JS 파일 수: ${result.length}`);
    return result;
  }

  // 단일 파일 코드 청킹
  async chunkFile(filePath: string): Promise<CodeChunk[]> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);

    const chunks = await this.extractCodeChunksFromFile(absolutePath);

    // 코드 청크에 대한 임베딩 배치 생성
    if (chunks.length > 0) {
      await this.generateEmbeddingsForChunks(chunks);
    }

    return chunks;
  }
}
