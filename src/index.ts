import { Server } from "@modelcontextprotocol/sdk/server/index.js"; // MCP 서버 import 복구
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // MCP 서버 import 복구
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"; // MCP 서버 import 복구
import { fileTools } from "./tools/files.js";
import { codeTools } from "./tools/code.js";
import "dotenv/config"; // 환경 변수 로딩
import { CodeChunkRepository } from "./services/codeChunkRepository"; // Repository import
import { ProjectService } from "./services/projectService";
import { commands, executeCommand, showHelp } from "./cli"; // CLI 명령어 파서 import

// 서버 설정 (복구)
const SERVER_CONFIG = {
  name: "mcp_codebase",
  version: "1.0.0",
};

// MCP에 노출될 도구 목록 (프로젝트 도구 제외) (복구)
const mcpExposedTools = [...fileTools, ...codeTools];

// --refresh 플래그 확인 함수
const shouldRefresh = (): boolean => {
  return process.argv.includes("--refresh");
};

// 사용법 출력 함수
const printUsage = () => {
  console.error("\n사용법:");
  console.error("  MCP 서버 모드: PROJECT_ID=<project_id> bun src/index.ts");
  console.error(
    "  새로고침 모드: PROJECT_ID=<project_id> bun src/index.ts --refresh"
  );
  console.error("\n  CLI 명령어: bun src/index.ts <명령어> [인자...]");
  console.error("  사용 가능한 명령어 목록: bun src/index.ts --help");
};

async function main() {
  // 필수 환경 변수 확인
  if (!process.env.DATABASE_URL) {
    console.error("오류: DATABASE_URL 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  // 서비스 인스턴스
  const repository = CodeChunkRepository.getInstance();
  const projectService = ProjectService.getInstance();

  // 데이터베이스 초기화 (서버/CLI 시작 시 한 번만)
  try {
    await repository.initializeDatabase();
  } catch (initError) {
    console.error("데이터베이스 초기화 실패:", initError);
    process.exit(1);
  }

  // 명령줄 인자
  const args = process.argv.slice(2);

  // 도움말 출력
  if (args.length === 0 || args[0] === "--help") {
    showHelp();
    process.exit(0);
  }

  // CLI 명령어 모드 확인
  const potentialCommand = args[0];
  if (
    !potentialCommand.startsWith("--") &&
    commands.some((cmd) => cmd.name === potentialCommand)
  ) {
    // CLI 명령어 모드로 실행
    try {
      await executeCommand(potentialCommand, args.slice(1));
      process.exit(0);
    } catch (error) {
      console.error("CLI 명령어 실행 중 오류 발생:", error);
      process.exit(1);
    }
  }

  // PROJECT_ID 환경 변수 확인
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    console.error("오류: PROJECT_ID 환경변수가 설정되지 않았습니다.");
    printUsage();
    process.exit(1);
  }

  console.error(`선택된 프로젝트 ID: ${projectId}`);

  // --refresh 플래그가 있으면 CLI 모드로 실행하고 종료
  if (shouldRefresh()) {
    console.error("CLI 모드: 코드베이스 새로고침(--refresh)을 시작합니다...");
    try {
      // 프로젝트 서비스를 통해 분석 (강제 새로고침으로 설정)
      const result = await projectService.analyzeProject(projectId, true);
      console.error("코드베이스 새로고침이 성공적으로 완료되었습니다.");
      console.error(`- 분석된 파일 수: ${result.analyzedFiles}`);
      console.error(`- 생성된 코드 청크 수: ${result.totalChunks}`);
      process.exit(0); // 성공 시 종료
    } catch (error) {
      console.error("코드베이스 새로고침 중 오류 발생:", error);
      process.exit(1); // 오류 발생 시 종료
    }
  } else {
    // --refresh 플래그가 없으면 MCP 서버 모드로 실행
    console.error("MCP 서버 모드로 시작합니다...");

    // Create server instance with capabilities (복구)
    const server = new Server(SERVER_CONFIG, {
      capabilities: {
        tools: {},
      },
    });

    // Define available tools (MCP에 노출될 도구만 포함) (복구)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: mcpExposedTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool execution (MCP 노출 도구만 대상으로 함)
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: clientArgs = {} } = request.params;

      // 이름으로 MCP 노출 도구 찾기
      const tool = mcpExposedTools.find((t) => t.name === name);

      if (!tool) {
        // 이 경우는 MCP 클라이언트가 ListTools에 없는 도구를 호출하려고 시도한 경우
        throw new Error(`MCP에서 사용할 수 없는 도구입니다: ${name}`);
      }

      try {
        // 디버깅을 위한 로깅 추가
        console.error(
          `MCP 도구 실행: ${name}`,
          JSON.stringify(clientArgs, null, 2)
        );

        // 클라이언트 인자 처리 (환경 변수에서 가져온 프로젝트 ID를 사용)
        // projectId가 있더라도 명시적으로 제거 (도구는 환경 변수에서 가져옴)
        const { projectId, ...cleanedArgs } = clientArgs;

        // 도구 실행 시 필수 파라미터 확인
        if (name === "search_code_chunks" && !cleanedArgs.query) {
          throw new Error("검색어(query)가 제공되지 않았습니다");
        }

        // 도구 실행 (타입 캐스팅)
        return await tool.execute(cleanedArgs as any);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`도구 실행 중 오류 발생: ${errorMessage}`);
      }
    });

    // 서버 연결 (복구)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Codebase Server running on stdio");
  }
}

main().catch((error) => {
  // main 함수 내에서 예상치 못한 오류 발생 시
  console.error("치명적인 오류 발생:", error);
  process.exit(1);
});
