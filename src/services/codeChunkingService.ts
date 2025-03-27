import * as path from "path";
import * as fs from "fs/promises";
import * as ts from "typescript";
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
  private projectRoot: string;
  private projectId: string;
  private embeddingService: EmbeddingService;
  private program: ts.Program | null = null;
  private typeChecker: ts.TypeChecker | null = null;

  constructor(projectRoot: string, projectId: string, apiKey?: string) {
    this.projectRoot = projectRoot;
    this.projectId = projectId;
    this.embeddingService = new EmbeddingService(apiKey);
  }

  // 서비스 초기화
  async initialize(): Promise<void> {
    // tsconfig.json 찾기
    const tsconfigPath = ts.findConfigFile(
      this.projectRoot,
      ts.sys.fileExists,
      "tsconfig.json"
    );

    if (!tsconfigPath) {
      // 기본 컴파일러 옵션 설정
      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
      };

      // 프로그램 생성
      this.program = ts.createProgram([], compilerOptions);
    } else {
      // tsconfig.json 파싱
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      );

      // 프로그램 생성
      this.program = ts.createProgram(
        parsedConfig.fileNames,
        parsedConfig.options
      );
    }

    this.typeChecker = this.program.getTypeChecker();
  }

  // 서비스 종료
  async shutdown(): Promise<void> {
    this.program = null;
    this.typeChecker = null;
  }

  private getNodePosition(
    node: ts.Node,
    sourceFile: ts.SourceFile
  ): {
    lineStart: number;
    lineEnd: number;
  } {
    const { line: lineStart } = ts.getLineAndCharacterOfPosition(
      sourceFile,
      node.getStart(sourceFile)
    );
    const { line: lineEnd } = ts.getLineAndCharacterOfPosition(
      sourceFile,
      node.getEnd()
    );
    return { lineStart: lineStart + 1, lineEnd: lineEnd + 1 };
  }

  private isFunctionLike(node: ts.Node): boolean {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    );
  }

  private getNodeType(
    node: ts.Node
  ): "function" | "class" | "type" | "constant" | null {
    if (this.isFunctionLike(node)) {
      return "function";
    } else if (ts.isClassDeclaration(node)) {
      return "class";
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      return "type";
    } else if (
      ts.isVariableDeclaration(node) &&
      node.parent &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      // 변수가 함수인지 확인
      const initializer = node.initializer;
      if (initializer && this.isFunctionLike(initializer)) {
        return "function";
      }
      return "constant";
    }
    return null;
  }

  private collectDependencies(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker
  ): string[] {
    const dependencies = new Set<string>();

    // 노드를 재귀적으로 방문하여 의존성 수집
    const visit = (node: ts.Node) => {
      // 식별자 처리
      if (ts.isIdentifier(node)) {
        const symbol = typeChecker.getSymbolAtLocation(node);
        if (symbol) {
          const declaration = symbol.declarations?.[0];
          if (declaration) {
            const name = symbol.getName();
            dependencies.add(name);
          }
        }
      }

      // 타입 참조 처리
      if (ts.isTypeReferenceNode(node)) {
        const type = typeChecker.getTypeFromTypeNode(node);
        const symbol = type.getSymbol();
        if (symbol) {
          const name = symbol.getName();
          dependencies.add(name);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(node);
    return Array.from(dependencies);
  }

  private async extractCodeChunksFromFile(
    filePath: string
  ): Promise<CodeChunk[]> {
    if (!this.program || !this.typeChecker) {
      throw new Error("TypeScript 프로그램이 초기화되지 않았습니다.");
    }

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return [];
    }

    // 상대 경로 계산
    const relativePath = path.relative(this.projectRoot, filePath);

    const chunks: CodeChunk[] = [];
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    const visit = (node: ts.Node) => {
      const type = this.getNodeType(node);
      if (type) {
        const { lineStart, lineEnd } = this.getNodePosition(node, sourceFile);
        const codeLines = lines.slice(lineStart - 1, lineEnd);
        const code = codeLines.join("\n");

        let name = "";
        if (
          (ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node)) &&
          node.name &&
          ts.isIdentifier(node.name)
        ) {
          name = node.name.text;
        } else if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name)
        ) {
          name = node.name.text;
        }

        if (name) {
          const dependencies = this.collectDependencies(
            node,
            sourceFile,
            this.typeChecker!
          );

          const chunk: CodeChunk = {
            id: uuidv4(),
            projectId: this.projectId,
            path: relativePath, // 상대 경로 사용
            code,
            type,
            name,
            lineStart,
            lineEnd,
            dependencies,
            dependents: [],
            embedding: null,
          };
          chunks.push(chunk);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return chunks;
  }

  // 프로젝트 전체 코드 청킹
  async chunkEntireProject(): Promise<CodeChunk[]> {
    const chunks = await this.chunkDirectory(this.projectRoot);

    // 청크 추출 후 의존성 후처리 작업 수행
    if (chunks.length > 0) {
      this.processChunkDependencies(chunks);
      this.analyzeChunkDependencyGraph(chunks);
    }

    return chunks;
  }

  // 디렉토리 내의 모든 파일 코드 청킹 (병렬 처리)
  async chunkDirectory(directoryPath: string): Promise<CodeChunk[]> {
    const absolutePath = path.isAbsolute(directoryPath)
      ? directoryPath
      : path.join(this.projectRoot, directoryPath);

    // 해당 디렉토리 내의 모든 TS/JS 파일 찾기
    const tsFiles = await this.findTsFilesInDirectory(absolutePath);

    if (tsFiles.length === 0) {
      return [];
    }

    // 처리 결과 추적용 변수
    let processedFiles = 0;
    let failedFiles = 0;

    // 파일별 처리를 Promise 배열로 변환하여 병렬 처리
    const chunkPromises = tsFiles.map(async (file) => {
      try {
        const fileChunks = await this.extractCodeChunksFromFile(file);

        processedFiles++;
        if (fileChunks.length > 0) {
        } else {
        }

        return fileChunks;
      } catch (error) {
        console.error(`오류: ${file} 청킹 실패:`, error);
        failedFiles++;
        return [] as CodeChunk[];
      }
    });

    // 모든 파일 처리 결과를 병렬로 기다림
    const chunksArrays = await Promise.all(chunkPromises);

    // 모든 청크 결과 병합
    let allChunks: CodeChunk[] = chunksArrays.flat();

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
      // 전처리된 코드 준비
      const preprocessedCodes = chunks.map((chunk) =>
        this.embeddingService.preprocessCodeForEmbedding(chunk.code, chunk.path)
      );

      // 배치로 임베딩 생성 (내부적으로 병렬 처리됨)
      const embeddings = await this.embeddingService.generateBatchEmbeddings(
        preprocessedCodes
      );

      // 각 청크에 임베딩 할당
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = embeddings[i];
      }
    } catch (error) {
      console.error("코드 청크 임베딩 생성 중 오류:", error);
      throw error;
    }
  }

  // 특정 디렉토리에서 모든 TypeScript/JavaScript 파일 찾기
  private async findTsFilesInDirectory(
    directoryPath: string
  ): Promise<string[]> {
    const result: string[] = [];

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

  // 청크 의존성 처리
  private processChunkDependencies(chunks: CodeChunk[]): void {
    // 이름 -> 청크 맵 생성
    const nameToChunkMap = new Map<string, CodeChunk>();
    for (const chunk of chunks) {
      nameToChunkMap.set(chunk.name, chunk);
    }

    // 의존성 해결
    for (const chunk of chunks) {
      const resolvedDeps: string[] = [];

      for (const depName of chunk.dependencies) {
        const targetChunk = nameToChunkMap.get(depName);
        if (targetChunk && targetChunk.id !== chunk.id) {
          resolvedDeps.push(depName);

          // 양방향 의존성 설정
          if (!targetChunk.dependents.includes(chunk.name)) {
            targetChunk.dependents.push(chunk.name);
          }
        }
      }

      chunk.dependencies = resolvedDeps;
    }
  }

  // 의존성 그래프 분석
  private analyzeChunkDependencyGraph(chunks: CodeChunk[]): void {
    // 이름 -> 청크 맵 생성
    const nameToChunkMap = new Map<string, CodeChunk>();
    for (const chunk of chunks) {
      nameToChunkMap.set(chunk.name, chunk);
    }

    // 각 청크의 전체 의존성 트리 분석
    let totalDependencies = 0;
    for (const chunk of chunks) {
      const visited = new Set<string>();
      const collectAllDeps = (name: string): string[] => {
        if (visited.has(name)) return [];
        visited.add(name);

        const targetChunk = nameToChunkMap.get(name);
        if (!targetChunk) return [];

        const allDeps = [...targetChunk.dependencies];
        for (const dep of targetChunk.dependencies) {
          const subDeps = collectAllDeps(dep);
          allDeps.push(...subDeps);
        }
        return Array.from(new Set(allDeps));
      };

      const allDeps = collectAllDeps(chunk.name);
      totalDependencies += allDeps.length;
    }
  }
}
