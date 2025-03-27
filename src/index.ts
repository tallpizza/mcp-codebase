import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { projectTools } from "./tools/projects";
import { fileTools } from "./tools/files";
import { codeTools } from "./tools/code";

// 서버 설정
const SERVER_CONFIG = {
  name: "mcp_codebase",
  version: "1.0.0",
};

// 모든 도구 수집
const allTools = [...projectTools, ...fileTools, ...codeTools];

// 환경 변수에서 프로젝트 ID 가져오기
const getProjectId = () => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    console.error("경고: PROJECT_ID 환경 변수가 설정되지 않았습니다.");
    process.exit(1);
  }
  return projectId;
};

async function main() {
  // 프로젝트 ID 확인
  const projectId = getProjectId();
  console.error("사용 중인 프로젝트 ID:", projectId);

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
