import {
  SymbolKind,
  SymbolInformation,
  DocumentSymbol,
  createProtocolConnection,
  InitializeRequest,
  DocumentSymbolRequest,
} from "vscode-languageserver-protocol";
import { spawn } from "child_process";
import * as net from "net";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import {
  IPCMessageReader,
  IPCMessageWriter,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node";

// 심볼 종류에 따른 코드 청크 타입 매핑
const symbolKindToChunkType = (
  kind: SymbolKind
): "function" | "class" | "type" | null => {
  switch (kind) {
    case SymbolKind.Function:
    case SymbolKind.Method:
      return "function";
    case SymbolKind.Class:
      return "class";
    case SymbolKind.Interface:
    case SymbolKind.Enum:
    case SymbolKind.TypeParameter:
      return "type";
    default:
      return null;
  }
};

// LSP 클라이언트 클래스
export class LspClient {
  private server: ReturnType<typeof spawn> | null = null;
  private socket: net.Socket | null = null;
  private connection: ReturnType<typeof createProtocolConnection> | null = null;
  private workspaceRoot: string;
  private isInitialized = false;
  private socketPath: string;
  private openDocuments = new Set<string>();
  private nextRequestId = 1;
  private responseBuffer = "";
  private pendingContentLength = -1;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.socketPath = path.join(
      process.platform === "win32" ? "\\\\.\\pipe\\" : "/tmp/",
      `typescript-language-server-${randomUUID()}.sock`
    );
  }

  // LSP 서버 시작 및 초기화
  async start(): Promise<void> {
    try {
      // 이미 초기화되었는지 확인
      if (this.isInitialized && this.server && !this.server.killed) {
        console.log(
          "LSP 서버가 이미 초기화되어 있습니다. 재시작 없이 재사용합니다."
        );
        return;
      }

      console.log("LSP 서버 시작 및 초기화 중...");

      // 서버 시작
      await this.startServer();

      if (!this.server || !this.server.stdin || !this.server.stdout) {
        throw new Error("LSP 서버 시작 실패");
      }

      console.log("LSP 서버 시작됨, 초기화 진행 중...");

      // 표준 입출력 처리 설정
      this.setupStdioHandling();

      // 초기화 요청 보내기
      const initializeResult = await this.sendInitializeRequest();
      console.log("초기화 요청 완료, 초기화 알림 전송 중...");

      // 초기화 완료 알림 보내기
      this.sendInitializedNotification();
      console.log("LSP 서버 초기화 완료");

      this.isInitialized = true;
    } catch (error) {
      console.error("LSP 서버 시작 오류:", error);

      // 실패한 경우 정리 수행
      if (this.server) {
        try {
          this.server.removeAllListeners();
          this.server.kill();
          this.server = null;
        } catch (cleanupError) {
          console.warn("서버 정리 중 오류:", cleanupError);
        }
      }

      this.isInitialized = false;
      throw error;
    }
  }

  // LSP 서버 종료
  async stop(): Promise<void> {
    console.log("LSP 서버 종료 중...");

    // 이미 정리된 상태인지 확인
    if (!this.server) {
      console.log("LSP 서버가 이미 종료되었습니다.");
      this.isInitialized = false;
      return;
    }

    try {
      // 열린 문서 모두 닫기
      for (const documentUri of Array.from(this.openDocuments)) {
        try {
          await this.closeDocument(documentUri);
        } catch (err) {
          console.warn(`문서 닫기 오류 (무시됨): ${documentUri}`, err);
        }
      }
      this.openDocuments.clear();

      // shutdown 요청 보내기
      if (this.isInitialized) {
        try {
          const requestId = this.nextRequestId++;
          const request = {
            jsonrpc: "2.0",
            id: requestId,
            method: "shutdown",
          };

          console.log("서버 종료 요청 보내는 중...");
          this.writeToProcess(JSON.stringify(request) + "\n");

          // 짧은 타임아웃으로 응답 대기 (실패해도 계속 진행)
          try {
            await Promise.race([
              this.waitForResponse(requestId),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("종료 요청 타임아웃")), 3000)
              ),
            ]);
            console.log("서버 종료 요청 응답 수신");
          } catch (timeoutErr) {
            console.warn("서버 종료 요청 타임아웃 (계속 진행)");
          }
        } catch (err) {
          console.warn("서버 종료 요청 오류 (계속 진행):", err);
        }
      }

      // exit 알림 보내기
      try {
        const notification = {
          jsonrpc: "2.0",
          method: "exit",
        };
        console.log("종료 알림 전송 중...");
        this.writeToProcess(JSON.stringify(notification) + "\n");
      } catch (err) {
        console.warn("종료 알림 전송 실패 (계속 진행):", err);
      }

      // 서버 프로세스 정리
      console.log("서버 프로세스 정리 중...");
      const killTimeout = setTimeout(() => {
        if (this.server && !this.server.killed) {
          console.log("서버가 정상 종료되지 않음, SIGKILL 사용");
          try {
            this.server.kill("SIGKILL");
          } catch (err) {
            console.warn("서버 강제 종료 오류:", err);
          }
        }
      }, 2000);

      // 정상 종료 시도
      if (this.server && !this.server.killed) {
        try {
          this.server.removeAllListeners();
          this.server.kill("SIGTERM");
        } catch (err) {
          console.warn("서버 종료 오류:", err);
        }
      }

      // 프로세스가 종료될 때까지 대기
      await new Promise<void>((resolve) => {
        if (!this.server || this.server.killed) {
          clearTimeout(killTimeout);
          resolve();
          return;
        }

        const onClose = () => {
          clearTimeout(killTimeout);
          resolve();
        };

        this.server.once("close", onClose);
        this.server.once("exit", onClose);
      });

      this.server = null;
      this.isInitialized = false;
      console.log("LSP 서버 종료 완료");
    } catch (error) {
      console.error("LSP 서버 종료 오류:", error);

      // 오류가 발생해도 서버 참조 정리
      if (this.server) {
        try {
          this.server.removeAllListeners();
          this.server.kill("SIGKILL");
        } catch (err) {
          // 무시
        }
        this.server = null;
      }

      this.isInitialized = false;
      throw error;
    }
  }

  // 파일의 심볼 정보 가져오기
  async getSymbols(filePath: string): Promise<SymbolInformation[]> {
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      try {
        console.log(
          `파일 심볼 요청: ${filePath} (시도 ${retryCount + 1}/${maxRetries})`
        );

        // 파일이 존재하고 접근 가능한지 확인
        try {
          await fs.access(filePath, fs.constants.R_OK);
        } catch (error) {
          console.error(`파일 접근 오류: ${filePath}`);
          return [];
        }

        // 파일 내용 읽기
        const fileContent = await fs.readFile(filePath, "utf-8");
        console.log(
          `파일 내용 읽기 성공: ${filePath}, 크기: ${fileContent.length} 바이트`
        );

        // 파일에 의미있는 코드가 있는지 기본 분석
        const { hasClass, hasFunction, hasType, hasExport } =
          this.analyzeFileForCode(fileContent);

        console.log(
          `기본 구문 분석: 클래스=${hasClass}, 함수=${hasFunction}, 인터페이스/타입=${hasType}, 익스포트=${hasExport}`
        );

        // 코드가 없으면 빈 배열 반환
        if (!hasClass && !hasFunction && !hasType && !hasExport) {
          console.log(`유의미한 코드가 없음: ${filePath}`);
          return [];
        }

        // LSP 서버 상태 확인 및 재시작 (필요한 경우)
        if (
          !this.isInitialized ||
          !this.server ||
          !this.server.stdin ||
          !this.server.stdout
        ) {
          console.log("LSP 서버가 준비되지 않음, 서버를 다시 시작합니다");
          await this.stop();
          await new Promise((resolve) => setTimeout(resolve, 500));
          await this.start();

          // 서버가 준비될 시간을 주기 위해 잠시 대기
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // 심볼 요청을 위한 문서 열기
        const fileUri = this.pathToUri(filePath);
        console.log(`LSP로 심볼 요청 전송 준비: ${filePath}`);

        try {
          await this.openDocument(fileUri, fileContent);
        } catch (error) {
          console.error(`문서 열기 오류: ${filePath}`, error);
          // 다시 시작 및 재시도
          await this.stop();
          await new Promise((resolve) => setTimeout(resolve, 500));
          await this.start();
          await new Promise((resolve) => setTimeout(resolve, 500));
          await this.openDocument(fileUri, fileContent);
        }

        // 심볼 요청 준비
        console.log(`심볼 요청 데이터 준비: ${filePath}`);
        const requestId = this.nextRequestId++;
        const request = {
          jsonrpc: "2.0",
          id: requestId,
          method: "textDocument/documentSymbol",
          params: {
            textDocument: {
              uri: fileUri,
            },
          },
        };

        console.log(`심볼 요청 전송: ${filePath}, ID: ${requestId}`);
        this.writeToProcess(JSON.stringify(request) + "\n");

        // 타임아웃과 함께 응답 기다리기
        const timeoutMs = 15000; // 15초로 타임아웃 증가

        try {
          console.log(
            `요청 ID ${requestId}에 대한 응답 대기 시작 (타임아웃: ${timeoutMs}ms)`
          );
          const response = await Promise.race([
            this.waitForResponse(requestId),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error(`심볼 요청 타임아웃: ${filePath}`)),
                timeoutMs
              );
            }),
          ]);

          console.log(`심볼 요청 응답 수신: ${filePath}, ID: ${requestId}`);

          // 문서 닫기 시도
          try {
            await this.closeDocument(fileUri);
          } catch (closeError) {
            console.warn(`문서 닫기 오류 무시: ${filePath}`, closeError);
          }

          console.log(
            `심볼 응답 분석: ${filePath}, 결과 존재: ${
              response.result ? "yes" : "no"
            }`
          );

          // 응답이 없는 경우 처리
          if (!response.result) {
            console.log(`파일 ${filePath}에 대한 심볼이 없습니다`);
            return [];
          }

          // 응답이 DocumentSymbol 배열인지 SymbolInformation 배열인지 확인
          const isDocumentSymbolResponse =
            Array.isArray(response.result) &&
            response.result.length > 0 &&
            "children" in response.result[0];

          let symbolInformations: SymbolInformation[] = [];

          if (isDocumentSymbolResponse) {
            console.log(`DocumentSymbol 형식 응답, 변환 필요`);
            // DocumentSymbol을 SymbolInformation으로 변환
            symbolInformations = this.flattenDocumentSymbols(
              response.result,
              fileUri,
              ""
            );
          } else {
            console.log(`SymbolInformation 형식 응답, 직접 사용`);
            symbolInformations = response.result as SymbolInformation[];
          }

          console.log(
            `심볼 처리 완료: ${filePath}, 심볼 수: ${symbolInformations.length}`
          );
          return this.filterSymbols(
            symbolInformations,
            hasClass,
            hasFunction,
            hasType,
            fileContent,
            filePath
          );
        } catch (error) {
          console.error(
            `심볼 요청 오류: ${filePath} (시도 ${
              retryCount + 1
            }/${maxRetries})`,
            error
          );
          lastError = error as Error;

          // 문서가 열려 있으면 닫기 시도
          try {
            await this.closeDocument(fileUri);
          } catch (closeError) {
            console.warn(`문서 닫기 오류 무시: ${filePath}`, closeError);
          }

          // 서버 재시작
          console.log("LSP 서버 재시작 중...");
          await this.stop();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await this.start();

          retryCount++;

          if (retryCount < maxRetries) {
            // 지수 백오프로 재시도 대기
            const delay = 1000 * Math.pow(2, retryCount);
            console.log(`${delay}ms 후 재시도...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      } catch (outerError) {
        console.error(`getSymbols 외부 오류: ${filePath}`, outerError);
        lastError = outerError as Error;
        retryCount++;

        if (retryCount < maxRetries) {
          const delay = 1000 * Math.pow(2, retryCount);
          console.log(`${delay}ms 후 재시도...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // 모든 재시도 실패
    console.error(`모든 재시도 실패 (${maxRetries}회): ${filePath}`);
    if (lastError) {
      console.error(`마지막 오류: ${lastError.message}`);
    }
    return [];
  }

  // 심볼 필터링을 위한 별도 메서드
  private filterSymbols(
    symbols: SymbolInformation[],
    hasClass: boolean,
    hasFunction: boolean,
    hasType: boolean,
    fileContent: string,
    filePath: string
  ): SymbolInformation[] {
    // 함수, 클래스, 인터페이스 등 관련 심볼만 필터링
    const relevantKinds = [
      5, // 클래스
      6, // 메서드
      9, // 네임스페이스
      11, // 인터페이스
      12, // 패키지
      10, // 열거형
      3, // 함수
      4, // 변수 (but only for top level exports)
      26, // TypeParameter
      13, // 속성 (특정 경우에만)
    ];

    // 최상위 레벨 심볼만 필터링
    const filteredSymbols = symbols.filter((symbol) => {
      return relevantKinds.includes(symbol.kind);
    });

    console.log(
      `필터링된 심볼 수: ${filteredSymbols.length}/${symbols.length}`
    );

    if (filteredSymbols.length === 0 && (hasClass || hasFunction || hasType)) {
      console.warn(
        `경고: 파일 ${filePath}에 코드가 있지만 심볼이 추출되지 않았습니다`
      );

      // 디버깅을 위해 파일의 처음 몇 줄 출력
      const firstFewLines = fileContent.split("\n").slice(0, 10).join("\n");
      console.log(`파일 미리보기:\n${firstFewLines}`);
    }

    return filteredSymbols;
  }

  // 문서가 열려 있는지 확인하고, 닫혀 있으면 열기
  private async ensureDocumentOpen(
    fileUri: string,
    forceReopen: boolean = false
  ): Promise<void> {
    try {
      if (forceReopen && this.openDocuments.has(fileUri)) {
        // 문서 닫기
        const closeRequestId = this.nextRequestId++;
        const closeRequest = {
          jsonrpc: "2.0",
          id: closeRequestId,
          method: "textDocument/didClose",
          params: {
            textDocument: {
              uri: fileUri,
            },
          },
        };

        this.writeToProcess(JSON.stringify(closeRequest) + "\n");
        this.openDocuments.delete(fileUri);
        console.log(`문서 강제 닫기: ${fileUri}`);

        // 잠시 기다려서 LSP 서버가 처리할 시간 주기
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!this.openDocuments.has(fileUri)) {
        // 파일 내용 읽기
        const filePath = fileUri.replace("file://", "");
        const content = await fs.readFile(filePath, "utf-8");

        // 문서 열기
        const openRequestId = this.nextRequestId++;
        const openRequest = {
          jsonrpc: "2.0",
          id: openRequestId,
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: fileUri,
              languageId: "typescript",
              version: 1,
              text: content,
            },
          },
        };

        this.writeToProcess(JSON.stringify(openRequest) + "\n");
        this.openDocuments.add(fileUri);
        console.log(`문서 열기: ${fileUri}`);

        // 잠시 기다려서 LSP 서버가 처리할 시간 주기
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`문서 열기 오류: ${fileUri}`, error);
    }
  }

  // TypeScript LSP 서버 시작
  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log("LSP 서버 시작 중...");

        // 기존 서버 정리
        if (this.server) {
          try {
            this.server.removeAllListeners();
            this.server.kill("SIGKILL");
            this.server = null;
          } catch (err) {
            console.warn("이전 서버 인스턴스 종료 중 오류:", err);
          }
        }

        // typescript-language-server 찾기
        // 1. 로컬 node_modules에서 찾기
        let serverPath = path.join(
          process.cwd(),
          "node_modules",
          ".bin",
          "typescript-language-server"
        );

        // NPM_PREFIX 환경 변수 확인 (글로벌 설치된 위치 확인)
        const npmPrefix = process.env.npm_config_prefix;
        const alternativeGlobalPath = npmPrefix
          ? path.join(npmPrefix, "bin", "typescript-language-server")
          : "";

        // NPX 경로 (macOS/Linux)
        const npxPath = "/usr/local/bin/typescript-language-server";

        console.log(`LSP 서버 기본 경로: ${serverPath}`);
        if (alternativeGlobalPath) {
          console.log(
            `LSP 서버 대체 경로 (npm global): ${alternativeGlobalPath}`
          );
        }

        // 서버 실행 전 경로 존재 여부 확인을 위한 헬퍼 함수
        const checkPath = async (pathToCheck: string): Promise<boolean> => {
          try {
            await fs.access(pathToCheck, fs.constants.X_OK);
            console.log(`서버 실행 파일 접근 가능: ${pathToCheck}`);
            return true;
          } catch (err) {
            console.log(`서버 실행 파일 접근 불가: ${pathToCheck}`);
            return false;
          }
        };

        // 모든 가능한 경로 체크 후 서버 실행
        const startServerWithValidPath = async () => {
          const localPathExists = await checkPath(serverPath);

          if (localPathExists) {
            startServerProcess(serverPath);
            return;
          }

          if (alternativeGlobalPath) {
            const globalPathExists = await checkPath(alternativeGlobalPath);
            if (globalPathExists) {
              startServerProcess(alternativeGlobalPath);
              return;
            }
          }

          const npxPathExists = await checkPath(npxPath);
          if (npxPathExists) {
            startServerProcess(npxPath);
            return;
          }

          // 어떤 경로도 유효하지 않으면 명령어 이름만 사용 (PATH에 있다고 가정)
          console.log(
            "유효한 서버 경로를 찾을 수 없음, 'typescript-language-server' 명령만 사용"
          );
          startServerProcess("typescript-language-server", true);
        };

        // 서버 프로세스 시작 함수
        const startServerProcess = (
          execPath: string,
          isCommandName = false
        ) => {
          try {
            let args = ["--stdio"];

            console.log(
              `서버 시작: ${isCommandName ? "명령어" : "경로"} = ${execPath}`
            );

            if (isCommandName) {
              this.server = spawn(execPath, args);
              console.log("명령어 이름으로 서버 시작");
            } else {
              this.server = spawn(execPath, args);
              console.log("지정된 경로로 서버 시작");
            }

            if (!this.server) {
              throw new Error("서버 시작 실패");
            }

            // 서버 오류 이벤트 처리
            this.server.on("error", (err) => {
              console.error("LSP 서버 시작 오류:", err);
              reject(err);
            });

            // 서버 종료 이벤트 처리
            this.server.on("close", (code) => {
              console.log(`LSP 서버 종료됨, 종료 코드: ${code}`);
              this.isInitialized = false;
            });

            // 서버 표준 오류 출력 모니터링
            this.server.stderr?.on("data", (data) => {
              const message = data.toString().trim();
              console.error(`LSP 서버 오류 출력: ${message}`);
            });

            // 서버 표준 출력 초기 모니터링 (초기화 단계에만 사용)
            let stdoutBuffer = "";
            const stdoutHandler = (data: Buffer) => {
              stdoutBuffer += data.toString();
              console.log(`서버 출력: ${data.toString().trim()}`);

              // 초기화 메시지 확인
              if (
                stdoutBuffer.includes("Using Typescript version") ||
                stdoutBuffer.includes("Starting TS") ||
                stdoutBuffer.includes("Initializing") ||
                stdoutBuffer.includes("Connected")
              ) {
                console.log("LSP 서버 시작 성공 징후 감지");

                // 시작 성공 처리
                setTimeout(() => {
                  this.server?.stdout?.removeListener("data", stdoutHandler);
                  resolve();
                }, 1000); // 더 여유있게 대기
              }
            };

            if (this.server.stdout) {
              this.server.stdout.on("data", stdoutHandler);
            } else {
              console.error("서버 stdout이 없습니다");
              reject(new Error("서버 stdout이 없습니다"));
            }

            // 타임아웃 설정 (10초)
            setTimeout(() => {
              if (this.server?.stdout) {
                this.server.stdout.removeListener("data", stdoutHandler);
              }

              // 서버가 시작됐는지 확인
              if (this.server && !this.server.killed) {
                console.log(
                  "LSP 서버 시작 타임아웃, 서버가 실행 중이므로 성공으로 처리"
                );
                resolve();
              } else {
                console.error("LSP 서버 시작 타임아웃, 서버가 실행되지 않음");
                reject(new Error("LSP 서버 시작 타임아웃"));
              }
            }, 10000); // 10초 타임아웃
          } catch (err) {
            console.error("서버 프로세스 시작 오류:", err);
            reject(err);
          }
        };

        // 서버 시작 로직 실행
        startServerWithValidPath().catch((err) => {
          console.error("서버 경로 확인 중 오류:", err);
          reject(err);
        });
      } catch (err) {
        console.error("startServer 외부 오류:", err);
        reject(err);
      }
    });
  }

  // LSP 서버에 연결
  private async connectToServer(): Promise<void> {
    if (!this.server || !this.server.stdin || !this.server.stdout) {
      throw new Error("Server not started");
    }

    try {
      console.log("LSP 서버에 연결 시도 중...");

      // 기존 소켓 정리
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.destroy();
        this.socket = null;
      }

      // 표준 입출력을 통한 연결 설정
      const reader = new StreamMessageReader(this.server.stdout);
      const writer = new StreamMessageWriter(this.server.stdin);
      this.connection = createProtocolConnection(reader, writer);

      // 연결 시작
      this.connection.listen();

      // this.socket 프로퍼티를 사용하지 않음 (대신 server.stdin을 직접 사용)
      console.log("LSP 서버에 연결 성공");
    } catch (error) {
      console.error("LSP 서버 연결 실패:", error);
      throw error;
    }
  }

  // 표준 입출력 처리 설정
  private setupStdioHandling(): void {
    if (!this.server || !this.server.stdout) {
      throw new Error("서버 또는 stdout이 없습니다");
    }

    // 응답 파서 설정
    this.responseBuffer = "";
    this.pendingContentLength = -1;

    // stdout 데이터 핸들러
    this.server.stdout.on("data", (data: Buffer) => {
      const message = data.toString();

      // 서버 디버깅을 위한 출력 (일반 운영 시 주석 처리)
      // console.log(`LSP 서버 출력: ${message.substring(0, 100)}...`);

      // 지금은 개별 요청에 대한 응답을 각 요청 핸들러에서 처리하므로,
      // 여기서는 특별한 처리를 하지 않음
    });

    // 서버 오류 처리
    this.server.on("error", (err) => {
      console.error("LSP 서버 오류:", err);
      this.isInitialized = false;
    });

    // 서버 종료 처리
    this.server.on("close", (code, signal) => {
      console.log(`LSP 서버 종료: 코드=${code}, 신호=${signal}`);
      this.isInitialized = false;
    });
  }

  // 초기화 요청 보내기
  private async sendInitializeRequest(): Promise<any> {
    const requestId = this.nextRequestId++;
    const request = {
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        processId: process.pid,
        clientInfo: {
          name: "MCP LSP Client",
          version: "1.0.0",
        },
        rootPath: process.cwd(),
        rootUri: this.pathToUri(process.cwd()),
        capabilities: {
          textDocument: {
            synchronization: {
              didSave: true,
              dynamicRegistration: true,
            },
            documentSymbol: {
              symbolKind: {
                valueSet: [
                  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                  19, 20, 21, 22, 23, 24, 25, 26,
                ],
              },
              hierarchicalDocumentSymbolSupport: true,
            },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        workspaceFolders: [
          {
            uri: this.pathToUri(process.cwd()),
            name: path.basename(process.cwd()),
          },
        ],
        initializationOptions: {
          preferences: {
            provideSignatureHelpInStringOrComment: true,
            allowIncompleteCompletions: true,
            includeCompletionsForImportStatements: true,
            includeCompletionsWithSnippetText: true,
            includeAutomaticOptionalChainCompletions: true,
            allowRenameOfImportPath: true,
          },
          tsserver: {
            logVerbosity: "verbose",
            trace: "messages",
            useSyntaxServer: "auto",
          },
          maxTsServerMemory: 4096,
        },
      },
    };

    console.log("초기화 요청 전송 중...");
    // Content-Length 헤더를 사용하여 메시지 길이 명시 (표준 LSP 프로토콜 메시지 형식)
    const messageStr = JSON.stringify(request);
    const contentLength = Buffer.byteLength(messageStr, "utf8");
    const requestText = `Content-Length: ${contentLength}\r\n\r\n${messageStr}`;

    console.log(`초기화 요청 내용: ${messageStr.substring(0, 200)}...`);

    this.writeToProcess(requestText);

    try {
      console.log(`초기화 요청(ID: ${requestId})에 대한 응답 대기 중...`);
      const response = await Promise.race([
        this.waitForResponse(requestId),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("초기화 요청 타임아웃")), 30000); // 30초 타임아웃
        }),
      ]);

      console.log("초기화 응답 수신");
      return response;
    } catch (error) {
      console.error("초기화 요청 실패:", error);
      throw error;
    }
  }

  // 초기화 완료 알림 보내기
  private sendInitializedNotification(): void {
    const notification = {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    };

    console.log("초기화 완료 알림 전송 중...");
    // Content-Length 헤더를 사용하여 메시지 길이 명시
    const messageStr = JSON.stringify(notification);
    const contentLength = Buffer.byteLength(messageStr, "utf8");
    const notificationText = `Content-Length: ${contentLength}\r\n\r\n${messageStr}`;

    this.writeToProcess(notificationText);
  }

  // 재귀적으로 DocumentSymbol을 SymbolInformation으로 변환
  private flattenDocumentSymbols(
    symbols: DocumentSymbol[],
    uri: string,
    containerName: string = ""
  ): SymbolInformation[] {
    let result: SymbolInformation[] = [];

    for (const symbol of symbols) {
      result.push({
        name: symbol.name,
        kind: symbol.kind,
        location: {
          uri,
          range: symbol.range,
        },
        containerName,
      });

      if (symbol.children) {
        result = result.concat(
          this.flattenDocumentSymbols(symbol.children, uri, symbol.name)
        );
      }
    }

    return result;
  }

  // 요청을 LSP 서버에 쓰기
  private writeToProcess(data: string): void {
    if (this.server && this.server.stdin) {
      // 이미 Content-Length 헤더가 있는지 확인
      if (!data.startsWith("Content-Length:")) {
        // 메시지에 Content-Length 헤더 추가
        const contentLength = Buffer.byteLength(data, "utf8");
        data = `Content-Length: ${contentLength}\r\n\r\n${data}`;
      }

      console.log(`LSP 서버에 데이터 쓰기 시도: ${data.substring(0, 100)}...`);

      try {
        this.server.stdin.write(data);
        console.log("데이터 쓰기 완료");
      } catch (err) {
        console.error("데이터 쓰기 오류:", err);
        throw new Error(`서버에 데이터 쓰기 실패: ${err}`);
      }
    } else {
      console.error("LSP 서버 stdin이 없습니다");
      throw new Error("서버 stdin이 없습니다");
    }
  }

  // 지정된 요청 ID의 응답을 기다림
  private waitForResponse(requestId: number): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log(`요청 ID ${requestId}에 대한 응답 대기 시작`);

      // 응답 처리 핸들러
      const handleResponse = (data: Buffer) => {
        const message = data.toString();

        try {
          // 메시지 분리 (여러 메시지가 한 번에 올 수 있음)
          const messages = this.splitMessages(message);

          for (const msg of messages) {
            try {
              const response = JSON.parse(msg);

              // 응답이 현재 요청의 것인지 확인
              if (response.id === requestId) {
                console.log(`요청 ID ${requestId}에 대한 응답 수신`);

                // 이벤트 리스너 제거
                if (this.server && this.server.stdout) {
                  this.server.stdout.removeListener("data", handleResponse);
                }

                // 오류 응답 처리
                if (response.error) {
                  console.error(
                    `요청 ID ${requestId}에 대한 오류 응답:`,
                    response.error
                  );
                  reject(
                    new Error(`LSP 오류: ${JSON.stringify(response.error)}`)
                  );
                  return;
                }

                // 성공 응답 반환
                resolve(response);
                return;
              }
            } catch (err) {
              console.warn(`JSON 파싱 오류 (무시됨): ${msg}`, err);
              // 단일 메시지 오류는 무시하고 계속 처리
            }
          }
        } catch (err) {
          console.error(`응답 처리 오류:`, err);
          // 치명적이지 않은 오류는 무시하고 계속 대기
        }
      };

      // 응답 대기 타임아웃
      const timeoutId = setTimeout(() => {
        if (this.server && this.server.stdout) {
          this.server.stdout.removeListener("data", handleResponse);
        }
        reject(new Error(`요청 ID ${requestId}에 대한 응답 타임아웃`));
      }, 10000); // 10초 타임아웃

      // 응답 리스너 등록
      if (this.server && this.server.stdout) {
        this.server.stdout.on("data", handleResponse);
      } else {
        console.error("서버 또는 stdout이 없음");
        clearTimeout(timeoutId);
        reject(new Error("서버 연결 오류"));
      }
    });
  }

  // 여러 LSP 메시지를 개별 메시지로 분리
  private splitMessages(data: string): string[] {
    const messages: string[] = [];
    let currentPos = 0;

    while (currentPos < data.length) {
      // Content-Length 헤더 찾기
      const headerMatch = data
        .substring(currentPos)
        .match(/Content-Length: (\d+)\r\n\r\n/);

      if (!headerMatch) {
        // 불완전한 메시지는 건너뜀
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = currentPos + headerMatch.index! + headerMatch[0].length;

      // 메시지 본문이 완전히 도착했는지 확인
      if (headerEnd + contentLength <= data.length) {
        const messageContent = data.substring(
          headerEnd,
          headerEnd + contentLength
        );
        messages.push(messageContent);
        currentPos = headerEnd + contentLength;
      } else {
        // 불완전한 메시지는 건너뜀
        break;
      }
    }

    return messages;
  }

  // 파일 경로를 URI로 변환
  private pathToUri(filePath: string): string {
    return `file://${filePath}`;
  }

  // 문서 열기
  async openDocument(uri: string, content: string): Promise<void> {
    if (this.openDocuments.has(uri)) {
      console.log(`문서가 이미 열려있음: ${uri}`);
      return;
    }

    console.log(`문서 열기 시도: ${uri}`);

    if (!this.server || !this.server.stdin || !this.isInitialized) {
      console.warn(
        "서버가 초기화되지 않았거나 연결이 없습니다. 서버를 다시 시작합니다."
      );
      await this.start();
    }

    const request = {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "typescript", // 기본값으로 typescript 설정
          version: 1,
          text: content,
        },
      },
    };

    this.writeToProcess(JSON.stringify(request) + "\n");
    this.openDocuments.add(uri);
    console.log(`문서 열기 성공: ${uri}`);

    // 서버가 처리할 시간을 주기 위해 잠시 대기
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // 문서 닫기
  async closeDocument(uri: string): Promise<void> {
    if (!this.openDocuments.has(uri)) {
      console.log(`이미 닫힌 문서: ${uri}`);
      return;
    }

    console.log(`문서 닫기 시도: ${uri}`);

    if (!this.server || !this.server.stdin) {
      console.warn("서버 연결이 없어 문서를 닫을 수 없습니다.");
      this.openDocuments.delete(uri); // 메모리에서는 제거
      return;
    }

    const request = {
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: {
        textDocument: {
          uri,
        },
      },
    };

    try {
      this.writeToProcess(JSON.stringify(request) + "\n");
      this.openDocuments.delete(uri);
      console.log(`문서 닫기 성공: ${uri}`);
    } catch (error) {
      console.error(`문서 닫기 실패: ${uri}`, error);
      // 오류가 발생해도 메모리에서 제거
      this.openDocuments.delete(uri);
    }
  }

  // 파일 코드 분석
  private analyzeFileForCode(content: string): {
    hasClass: boolean;
    hasFunction: boolean;
    hasType: boolean;
    hasExport: boolean;
  } {
    // 기본적인 구문 분석 (클래스, 함수, 인터페이스 등이 있는지 체크)
    const hasClass = content.includes("class ");
    const hasFunction =
      content.includes("function ") ||
      /const\s+\w+\s*=\s*(\(.*\)|async\s*\(.*\))\s*=>/.test(content) ||
      /\w+\s*\(.*\)\s*{/.test(content);
    const hasType =
      content.includes("interface ") ||
      content.includes("type ") ||
      content.includes("enum ");
    const hasExport = content.includes("export ");

    return { hasClass, hasFunction, hasType, hasExport };
  }
}
