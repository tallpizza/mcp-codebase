import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { projectTools } from "./tools/projects.js";
import { fileTools } from "./tools/files.js";
import { codeTools } from "./tools/code.js";

// 서버 설정
const SERVER_CONFIG = {
  name: "mcp_codebase",
  version: "1.0.0",
};

// 모든 도구 수집
const allTools = [...projectTools, ...fileTools, ...codeTools];

// 프로젝트 ID 가져오기 - 명령줄 인자에서
const getProjectId = (): string => {
  // 명령줄 인자 확인
  const args = process.argv.slice(2);
  let projectId: string | undefined;

  // 인자 처리
  for (let i = 0; i < args.length; i++) {
    // --project_id value 형식 처리
    if (args[i] === "--project_id" && i + 1 < args.length) {
      projectId = args[i + 1];
      break;
    }
    // --project_id=value 형식 처리 (하위 호환성)
    else if (args[i].startsWith("--project_id=")) {
      projectId = args[i].split("=")[1];
      break;
    }
  }

  // 위치 인자 처리 (첫 번째 인자가 옵션이 아닌 경우)
  if (!projectId && args.length > 0 && !args[0].startsWith("--")) {
    projectId = args[0];
  }

  // 프로젝트 ID 검증
  if (!projectId) {
    console.error("오류: 프로젝트 ID가 제공되지 않았습니다.");
    console.error("사용법: bun index.ts --project_id <project_id>");
    console.error("또는: bun index.ts --project_id=<project_id>");
    console.error("또는: bun index.ts <project_id>");
    process.exit(1);
  }

  return projectId;
};

async function main() {
  // 프로젝트 ID 확인
  const projectId = getProjectId();
  console.error(`사용 중인 프로젝트 ID: ${projectId}`);

  // 전역적으로 process.env에 설정하여 다른 모듈에서도 참조 가능하게 설정
  process.env.PROJECT_ID = projectId;

  // Create server instance with capabilities
  const server = new Server(SERVER_CONFIG, {
    capabilities: {
      tools: {},
    },
  });

  // Define available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: clientArgs = {} } = request.params;

    // 이름으로 도구 찾기
    const tool = allTools.find((t) => t.name === name);

    if (!tool) {
      throw new Error(`도구를 찾을 수 없습니다: ${name}`);
    }

    try {
      // 클라이언트 인자에서 projectId 제거 (환경 변수에서 가져온 값을 도구 내부에서 사용)
      const { projectId: _, ...args } = clientArgs;

      console.error(`도구 실행: ${name}`, JSON.stringify(args, null, 2));

      // 도구 실행 (타입 안전성을 위해 any 형변환)
      return await tool.execute(args as any);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`도구 실행 중 오류 발생: ${errorMessage}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Codebase Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
