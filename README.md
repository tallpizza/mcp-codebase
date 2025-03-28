run.sh 파일로 mcp 테스트 서버를 실행 시킬 수 있다.

MCP client 설정용 JSON

```json
{
  "mcpServers": {
    "backend-query": {
      "command": "node",
      "args": ["{PATH_TO_MCP_SERVER}/build/index.js", "{PROJECT_ID}"],
      "env": {
        "DATABASE_URL": "{DATABASE_URL}",
        "OPENAI_API_KEY": "{OPENAI_API_KEY}"
      }
    }
  }
}
```
