To install dependencies:

```sh
bun install
```

To run:

```sh
bun run dev
```

open http://localhost:3000

## CLI 사용법

### 프로젝트 관리

```sh
# 프로젝트 생성
bun src/index.ts create-project --path /path/to/git/repo --name "프로젝트 이름" --description "프로젝트 설명"

# 프로젝트 목록 조회
bun src/index.ts list-projects

# 프로젝트 분석
bun src/index.ts analyze-project --project_id <project_id>

# 프로젝트 강제 재분석
bun src/index.ts analyze-project --project_id <project_id> --refresh

# 프로젝트 삭제
bun src/index.ts delete-project --project_id <project_id>

# 프로젝트 강제 삭제 (확인 없음)
bun src/index.ts delete-project --project_id <project_id> --force
```

### MCP 서버 모드

프로젝트 내에서 build 후

```json
{
  "mcpServers": {
    "Backend": {
      "command": "node",
      "args": ["{AbsolutePath}/build/index.ts"],
      "env": {
        "DATABASE_URL": "",
        "OPENAI_API_KEY": "",
        "PROJECT_ID": ""
      }
    }
  }
}
```
