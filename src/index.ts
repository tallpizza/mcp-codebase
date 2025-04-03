import { Server } from "@modelcontextprotocol/sdk/server/index.js"; // MCP 서버 import 복구
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // MCP 서버 import 복구
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"; // MCP 서버 import 복구
import { projectTools, analyzeProject } from "./tools/projects.js";
import { fileTools } from "./tools/files.js";
import { codeTools } from "./tools/code.js";
import "dotenv/config"; // 환경 변수 로딩
import { CodeChunkRepository } from "./services/codeChunkRepository"; // Repository import

// 서버 설정 (복구)
const SERVER_CONFIG = {
  name: "mcp_codebase",
  version: "1.0.0",
};

// MCP에 노출될 도구 목록 (analyzeProject 제외) (복구)
const mcpExposedTools = [...projectTools, ...fileTools, ...codeTools];

// 프로젝트 ID 가져오기 - 명령줄 인자에서
const getProjectId = (): string => {
  // 명령줄 인자 확인
  const args = process.argv.slice(2);
  let projectId: string | undefined;

  // 인자 처리 ( --project_id 와 위치 인자 )
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project_id" && i + 1 < args.length) {
      // --refresh 플래그가 아닌 다음 인자를 projectId로 간주
      if (args[i + 1] !== "--refresh") {
        projectId = args[i + 1];
        break;
      }
    } else if (args[i].startsWith("--project_id=")) {
      projectId = args[i].split("=")[1];
      break;
    }
  }
  if (!projectId && args.length > 0 && !args[0].startsWith("--")) {
    // 첫번째 인자가 옵션이 아니고 projectId 가 아직 설정되지 않았다면 위치 인자로 간주
    // 단, --refresh 플래그는 제외
    if (args[0] !== "--refresh") {
      projectId = args[0];
    } else if (args.length > 1 && !args[1].startsWith("--")) {
      // --refresh 다음 인자가 옵션이 아니라면 projectId로 간주
      projectId = args[1];
    }
  }

  // 프로젝트 ID 검증
  if (!projectId) {
    console.error("오류: 프로젝트 ID가 제공되지 않았습니다.");
    printUsage();
    process.exit(1);
  }

  return projectId;
};

// --refresh 플래그 확인 함수
const shouldRefresh = (): boolean => {
  return process.argv.includes("--refresh");
};

// 사용법 출력 함수
const printUsage = () => {
  console.error("\n사용법:");
  console.error("  MCP 서버 모드: bun src/index.ts --project_id <project_id>");
  console.error("                 bun src/index.ts --project_id=<project_id>");
  console.error("                 bun src/index.ts <project_id>");
  console.error(
    "  새로고침 모드: bun src/index.ts --project_id <project_id> --refresh"
  );
  console.error("                 bun src/index.ts <project_id> --refresh");
};

async function main() {
  // 필수 환경 변수 확인
  if (!process.env.DATABASE_URL) {
    console.error("오류: DATABASE_URL 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  // 데이터베이스 초기화 (서버/CLI 시작 시 한 번만)
  try {
    const repository = CodeChunkRepository.getInstance();
    await repository.initializeDatabase();
  } catch (initError) {
    console.error("데이터베이스 초기화 실패:", initError);
    process.exit(1);
  }

  // 프로젝트 ID 확인 및 환경 변수 설정
  const projectId = getProjectId();
  process.env.PROJECT_ID = projectId; // 모든 도구 내부에서 사용
  console.error(`선택된 프로젝트 ID: ${projectId}`);

  // --refresh 플래그가 있으면 CLI 모드로 실행하고 종료
  if (shouldRefresh()) {
    console.error("CLI 모드: 코드베이스 새로고침(--refresh)을 시작합니다...");
    try {
      // analyzeProject 도구 직접 실행
      await analyzeProject.execute({} as any);
      console.error("코드베이스 새로고침이 성공적으로 완료되었습니다.");
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
