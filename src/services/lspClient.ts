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
  private isConnectionActive: boolean = false;
  private isShuttingDown: boolean = false;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot); // 절대 경로로 변환
  }

  /**
   * LSP 서버를 시작하고 초기화
   */
  async start(): Promise<void> {
    if (this.isConnectionActive) {
      console.log("LSP 클라이언트가 이미 활성화되어 있습니다.");
      return;
    }

    if (this.isShuttingDown) {
      console.log(
        "LSP 클라이언트가 종료 중입니다. 새 요청을 처리할 수 없습니다."
      );
      return;
    }

    try {
      // typescript-language-server 실행 (stdio를 통해 통신)
      this.serverProcess = spawn("typescript-language-server", ["--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
        throw new Error("LSP 서버의 스트림을 초기화할 수 없습니다.");
      }

      // 서버 프로세스 오류 및 종료 이벤트 처리
      this.serverProcess.on("error", (err) => {
        console.error("LSP 서버 프로세스 오류:", err);
        this.isConnectionActive = false;
      });

      this.serverProcess.on("exit", (code, signal) => {
        console.log(`LSP 서버 종료됨 (코드: ${code}, 신호: ${signal})`);
        this.isConnectionActive = false;
      });

      // JSON-RPC 연결 설정
      this.connection = rpc.createMessageConnection(
        new rpc.StreamMessageReader(this.serverProcess.stdout),
        new rpc.StreamMessageWriter(this.serverProcess.stdin)
      );

      // 연결 오류 핸들러 설정
      this.connection.onError((err) => {
        console.error("LSP 연결 오류:", err);
        this.isConnectionActive = false;
      });

      this.connection.onClose(() => {
        console.log("LSP 연결 닫힘");
        this.isConnectionActive = false;
      });

      this.connection.listen();
      this.isConnectionActive = true;

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
      console.log("LSP 서버 초기화 완료");

      // 초기화 완료 알림
      this.connection.sendNotification("initialized", {});
    } catch (error) {
      this.isConnectionActive = false;
      console.error("LSP 서버 시작 실패:", error);
      await this.cleanupResources();
      throw new Error(`LSP 서버 시작 실패: ${error}`);
    }
  }

  /**
   * 주어진 파일에서 심볼 정보 추출
   * @param filePath 절대 파일 경로
   * @returns SymbolInformation 배열
   */
  async getSymbols(filePath: string): Promise<SymbolInformation[]> {
    if (!this.connection || !this.isConnectionActive) {
      console.log("LSP 연결이.활성화되지 않음, 재연결 시도...");
      await this.start();

      if (!this.connection || !this.isConnectionActive) {
        throw new Error("LSP 클라이언트 재연결 실패");
      }
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
    } catch (error: any) {
      console.error(`심볼 추출 실패 (${filePath}):`, error);
      // 오류 발생 시 연결 상태 업데이트
      if (
        error.message &&
        (error.message.includes("destroyed") ||
          error.message.includes("close") ||
          error.message.includes("terminated"))
      ) {
        this.isConnectionActive = false;
      }
      return [];
    }
  }

  /**
   * 리소스 정리
   */
  private async cleanupResources(): Promise<void> {
    try {
      if (this.connection) {
        this.connection.dispose();
        this.connection = null;
      }

      if (this.serverProcess) {
        this.serverProcess.kill();
        this.serverProcess = null;
      }
    } catch (err) {
      console.error("리소스 정리 중 오류:", err);
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

    this.isShuttingDown = true;

    try {
      if (this.isConnectionActive) {
        await this.connection.sendRequest("shutdown");
        this.connection.sendNotification("exit");
      }

      await this.cleanupResources();
      console.log("LSP 서버 종료 완료");
    } catch (error) {
      console.error("LSP 서버 종료 실패:", error);
      await this.cleanupResources();
    } finally {
      this.isConnectionActive = false;
      this.isShuttingDown = false;
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
