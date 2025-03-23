import { spawn, ChildProcess } from "child_process";
import * as rpc from "vscode-jsonrpc/node";
import {
  SymbolInformation,
  InitializeParams,
  DocumentSymbolParams,
  DidOpenTextDocumentParams,
} from "vscode-languageserver-protocol";
import * as path from "path";
import * as fs from "fs/promises";

/**
 * LSP 클라이언트 클래스
 * TypeScript/JavaScript 파일에서 심볼 정보를 추출하기 위해 typescript-language-server와 통신
 */
export class LspClient {
  private serverProcess: ChildProcess | null = null;
  private connection: rpc.MessageConnection | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot); // 절대 경로로 변환
  }

  /**
   * LSP 서버를 시작하고 초기화
   */
  async start(): Promise<void> {
    try {
      // typescript-language-server 실행 (stdio를 통해 통신)
      this.serverProcess = spawn("typescript-language-server", ["--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
        throw new Error("LSP 서버의 스트림을 초기화할 수 없습니다.");
      }

      // JSON-RPC 연결 설정
      this.connection = rpc.createMessageConnection(
        new rpc.StreamMessageReader(this.serverProcess.stdout),
        new rpc.StreamMessageWriter(this.serverProcess.stdin)
      );

      this.connection.listen();

      // LSP 초기화 요청
      const initializeParams: InitializeParams = {
        processId: process.pid,
        rootUri: `file://${this.projectRoot}`,
        capabilities: {
          textDocument: {
            documentSymbol: {
              dynamicRegistration: false,
            },
          },
        },
        workspaceFolders: [
          {
            uri: `file://${this.projectRoot}`,
            name: path.basename(this.projectRoot),
          },
        ],
      };

      const initResult = await this.connection.sendRequest(
        "initialize",
        initializeParams
      );
      console.log("LSP 서버 초기화 완료:", initResult);

      // 초기화 완료 알림
      this.connection.sendNotification("initialized", {});
    } catch (error) {
      console.error("LSP 서버 시작 실패:", error);
      throw new Error(`LSP 서버 시작 실패: ${error}`);
    }
  }

  /**
   * 주어진 파일에서 심볼 정보 추출
   * @param filePath 절대 파일 경로
   * @returns SymbolInformation 배열
   */
  async getSymbols(filePath: string): Promise<SymbolInformation[]> {
    if (!this.connection) {
      throw new Error("LSP 클라이언트가 초기화되지 않았습니다.");
    }

    try {
      const absolutePath = path.resolve(filePath);
      const uri = `file://${absolutePath}`;
      const content = await fs.readFile(absolutePath, "utf-8");
      const languageId = this.getLanguageId(absolutePath);

      // 파일 열기 알림
      const didOpenParams: DidOpenTextDocumentParams = {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      };
      await this.connection.sendNotification(
        "textDocument/didOpen",
        didOpenParams
      );

      // 심볼 정보 요청
      const symbolParams: DocumentSymbolParams = {
        textDocument: { uri },
      };
      const symbols = await this.connection.sendRequest(
        "textDocument/documentSymbol",
        symbolParams
      );

      return (symbols as SymbolInformation[]) || [];
    } catch (error) {
      console.error(`심볼 추출 실패 (${filePath}):`, error);
      return [];
    }
  }

  /**
   * LSP 서버 종료
   */
  async stop(): Promise<void> {
    if (!this.connection || !this.serverProcess) {
      console.warn("종료할 LSP 클라이언트가 없습니다.");
      return;
    }

    try {
      await this.connection.sendRequest("shutdown");
      this.connection.sendNotification("exit");
      this.serverProcess.kill();
      this.connection.dispose();
      console.log("LSP 서버 종료 완료");
    } catch (error) {
      console.error("LSP 서버 종료 실패:", error);
      this.serverProcess.kill("SIGKILL"); // 강제 종료
    } finally {
      this.connection = null;
      this.serverProcess = null;
    }
  }

  /**
   * 파일 확장자에 따라 languageId 반환
   * @param filePath 파일 경로
   * @returns languageId (typescript, javascript 등)
   */
  private getLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".ts":
      case ".tsx":
        return "typescript";
      case ".js":
      case ".jsx":
        return "javascript";
      default:
        return "plaintext";
    }
  }
}
