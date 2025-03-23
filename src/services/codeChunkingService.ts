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
  type: "function" | "class" | "type" | "constant";
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

  private isFunctionVariable(code: string): boolean {
    const firstLine = code.split("\n")[0].trim();
    // 화살표 함수 또는 함수 표현식 패턴
    const arrowFunctionRegex =
      /^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\(.*\)\s*=>/;
    const functionExpressionRegex =
      /^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?function\s*\(/;
    return (
      arrowFunctionRegex.test(firstLine) ||
      functionExpressionRegex.test(firstLine)
    );
  }

  private async extractCodeChunksFromFile(
    filePath: string
  ): Promise<CodeChunk[]> {
    const content = await fs.readFile(filePath, "utf-8");
    const symbols = await this.lspClient.getSymbols(filePath);
    const chunks: CodeChunk[] = [];
    const lines = content.split("\n");

    if (!symbols || symbols.length === 0) {
      console.log(`파일에서 심볼을 찾을 수 없음: ${filePath}`);
      return [];
    }

    // 클래스(5), 함수(12), 메서드(6), 인터페이스(11), 타입 별칭(26), 변수(13) 필터링
    const relevantSymbols = symbols.filter((symbol) =>
      [5, 12, 6, 11, 26, 13].includes(symbol.kind)
    );

    for (const symbol of relevantSymbols) {
      const startLine = symbol.location.range.start.line;
      const endLine = symbol.location.range.end.line;
      const codeLines = lines.slice(startLine, endLine + 1);
      const code = codeLines.join("\n");
      const name = symbol.name;

      let type: "function" | "class" | "type" | "constant" | null = null;

      if (symbol.kind === 5) {
        type = "class";
      } else if (symbol.kind === 12 || symbol.kind === 6) {
        type = "function";
      } else if (symbol.kind === 11 || symbol.kind === 26) {
        type = "type";
      } else if (symbol.kind === 13) {
        if (this.isFunctionVariable(code)) {
          type = "function"; // 함수로 정의된 변수
        } else {
          type = "constant"; // 함수가 아닌 const 상수
        }
      }

      if (type) {
        const chunk: CodeChunk = {
          id: uuidv4(),
          projectId: this.projectId,
          path: filePath,
          code,
          type,
          name,
          lineStart: startLine,
          lineEnd: endLine,
          dependencies: this.analyzeDependencies(code),
          dependents: [],
          embedding: null,
        };
        chunks.push(chunk);
      }
    }

    this.analyzeDependencyGraph(chunks);
    return chunks;
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

      // 5. 중복 제거 및 JavaScript 내장 객체/함수 제외
      const jsBuiltins = [
        "Array",
        "Object",
        "String",
        "Number",
        "Boolean",
        "Date",
        "Math",
        "RegExp",
        "Function",
        "Promise",
        "Set",
        "Map",
        "WeakMap",
        "WeakSet",
        "Symbol",
        "Error",
        "JSON",
        "Int8Array",
        "Uint8Array",
        "console",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "requestAnimationFrame",
        "localStorage",
        "sessionStorage",
        "Event",
        "XMLHttpRequest",
        "fetch",
        "document",
        "window",
        "Buffer",
        "process",
        "require",
        "module",
        "exports",
        "global",
        "__dirname",
        "__filename",
      ];

      return Array.from(new Set(dependencies)).filter(
        (dep) => !jsBuiltins.includes(dep)
      );
    } catch (err) {
      console.error("의존성 분석 중 오류:", err);
      return dependencies;
    }
  }

  private analyzeDependencyGraph(chunks: CodeChunk[]): void {
    const chunkMap = new Map<string, CodeChunk>();
    // 청크를 이름으로 매핑
    chunks.forEach((chunk) => {
      chunkMap.set(chunk.name, chunk);
    });

    // 각 청크의 dependencies를 분석하여 dependents 업데이트
    chunks.forEach((chunk) => {
      chunk.dependencies.forEach((depName) => {
        const depChunk = chunkMap.get(depName);
        if (depChunk && !depChunk.dependents.includes(chunk.name)) {
          depChunk.dependents.push(chunk.name); // dependents에 추가
        }
      });
    });
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
