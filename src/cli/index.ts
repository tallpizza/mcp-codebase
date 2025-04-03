import { Tool } from "../types/tool";
import { projects } from "../db/schema";
import { CodeChunkRepository } from "../services/codeChunkRepository";

// CLI 명령어 타입 정의
export type CliCommand = {
  name: string;
  description: string;
  execute: (args: string[]) => Promise<void>;
};

// CLI 인자 파싱 옵션
export type ParseOptions = {
  // 필수 인자 (반드시 존재해야 함)
  requiredArgs?: string[];
  // 선택적 인자 (존재할 수도 있음)
  optionalArgs?: string[];
  // 플래그 인자 (--flag 형태)
  flags?: string[];
  // 이름 있는 인자 (--name=value 또는 --name value 형태)
  namedArgs?: string[];
  // 인자 설명 (인자 이름 -> 설명)
  descriptions?: Record<string, string>;
  // 사용 예제
  examples?: string[];
};

// 파싱된 인자 결과
export type ParsedArgs = {
  // 위치 인자 (이름 없이 순서대로 제공되는 인자)
  positional: string[];
  // 이름 있는 인자 (--name=value 또는 --name value 형태)
  named: Record<string, string>;
  // 플래그 인자 (존재 여부만 확인)
  flags: Record<string, boolean>;
};

/**
 * CLI 인자 파싱 함수
 * @param args 명령줄 인자 배열 (process.argv.slice(2) 등)
 * @param options 파싱 옵션
 * @returns 파싱된 인자 객체
 */
export function parseArgs(
  args: string[],
  options: ParseOptions = {}
): ParsedArgs {
  const result: ParsedArgs = {
    positional: [],
    named: {},
    flags: {},
  };

  // 옵션으로 제공된 모든 플래그를 기본적으로 false로 초기화
  if (options.flags) {
    for (const flag of options.flags) {
      result.flags[flag] = false;
    }
  }

  // 인자 처리
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // --name=value 형태의 이름 있는 인자
    if (arg.startsWith("--") && arg.includes("=")) {
      const [name, value] = arg.slice(2).split("=", 2);
      if (options.namedArgs?.includes(name)) {
        result.named[name] = value;
      }
      continue;
    }

    // --flag 형태의 플래그 인자
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (options.flags?.includes(name)) {
        result.flags[name] = true;
        continue;
      }

      // --name value 형태의 이름 있는 인자
      if (
        options.namedArgs?.includes(name) &&
        i + 1 < args.length &&
        !args[i + 1].startsWith("--")
      ) {
        result.named[name] = args[i + 1];
        i++; // 다음 인자 건너뛰기
        continue;
      }
    }

    // 위 조건에 해당하지 않는 경우 위치 인자로 처리
    result.positional.push(arg);
  }

  return result;
}

/**
 * 필수 인자 검증 함수
 * @param args 파싱된 인자 객체
 * @param options 파싱 옵션
 * @returns 유효성 검증 결과 (에러 메시지 또는 null)
 */
export function validateArgs(
  args: ParsedArgs,
  options: ParseOptions
): string | null {
  // 필수 인자 확인
  if (options.requiredArgs) {
    for (const requiredArg of options.requiredArgs) {
      if (!args.named[requiredArg]) {
        return `필수 인자가 누락되었습니다: ${requiredArg}`;
      }
    }
  }

  return null; // 유효성 검증 통과
}

/**
 * 사용법 메시지 생성 함수
 * @param commandName 명령어 이름
 * @param description 명령어 설명
 * @param options 파싱 옵션
 * @returns 사용법 메시지
 */
export function generateUsage(
  commandName: string,
  description: string,
  options: ParseOptions
): string {
  let usage = `사용법: bun src/index.ts ${commandName}`;

  // 필수 인자 추가
  if (options.requiredArgs && options.requiredArgs.length > 0) {
    for (const arg of options.requiredArgs) {
      usage += ` --${arg} <${arg}>`;
    }
  }

  // 선택적 인자 추가
  if (options.optionalArgs && options.optionalArgs.length > 0) {
    for (const arg of options.optionalArgs) {
      usage += ` [--${arg} <${arg}>]`;
    }
  }

  // 플래그 추가
  if (options.flags && options.flags.length > 0) {
    for (const flag of options.flags) {
      usage += ` [--${flag}]`;
    }
  }

  // 명령어 설명 추가
  usage += `\n\n${description}\n\n`;

  // 인자 설명 추가
  if (options.requiredArgs && options.requiredArgs.length > 0) {
    usage += "필수 인자:\n";
    for (const arg of options.requiredArgs) {
      const desc = options.descriptions?.[arg] || "";
      usage += `  --${arg} <${arg}>${desc ? ` - ${desc}` : ""}\n`;
    }
    usage += "\n";
  }

  // 선택적 인자 설명 추가
  if (options.optionalArgs && options.optionalArgs.length > 0) {
    usage += "선택적 인자:\n";
    for (const arg of options.optionalArgs) {
      const desc = options.descriptions?.[arg] || "";
      usage += `  --${arg} <${arg}>${desc ? ` - ${desc}` : ""}\n`;
    }
    usage += "\n";
  }

  // 플래그 설명 추가
  if (options.flags && options.flags.length > 0) {
    usage += "플래그:\n";
    for (const flag of options.flags) {
      const desc = options.descriptions?.[flag] || "";
      usage += `  --${flag}${desc ? ` - ${desc}` : ""}\n`;
    }
    usage += "\n";
  }

  // 사용 예제 추가
  if (options.examples && options.examples.length > 0) {
    usage += "예제:\n";
    for (const example of options.examples) {
      usage += `  ${example}\n`;
    }
  }

  return usage;
}

// 저장소 인스턴스
const repository = CodeChunkRepository.getInstance();

// 프로젝트 생성 명령어
export const createProjectCommand: CliCommand = {
  name: "create-project",
  description: "새로운 프로젝트를 생성합니다",
  async execute(args: string[]) {
    // 인자 파싱 옵션
    const options: ParseOptions = {
      requiredArgs: ["path"],
      optionalArgs: ["name", "description"],
      flags: [],
      namedArgs: ["path", "name", "description"],
      descriptions: {
        path: "프로젝트 루트 디렉토리 경로 (절대 경로 또는 상대 경로)",
        name: "프로젝트 이름 (생략 시 경로의 마지막 디렉토리 이름으로 자동 설정)",
        description: "프로젝트에 대한 간단한 설명",
      },
      examples: [
        "bun src/index.ts create-project --path /path/to/project",
        'bun src/index.ts create-project --path /path/to/project --name "My Project"',
        'bun src/index.ts create-project --path ./my-project --name "My Project" --description "A sample project"',
      ],
    };

    // 인자 파싱
    const parsedArgs = parseArgs(args, options);

    // 필수 인자 검증
    const validationError = validateArgs(parsedArgs, options);
    if (validationError) {
      console.error(`오류: ${validationError}`);
      console.error(generateUsage(this.name, this.description, options));
      process.exit(1);
    }

    // 프로젝트 경로는 필수
    const path = parsedArgs.named.path;

    // 프로젝트 이름이 제공되지 않은 경우 경로에서 유추 (마지막 디렉토리 이름)
    let name = parsedArgs.named.name;
    if (!name) {
      // 경로의 끝에 있는 슬래시 제거
      const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
      // 마지막 디렉토리 이름 추출
      name = cleanPath.split("/").pop() || "unnamed-project";
    }

    // 선택적 설명
    const description = parsedArgs.named.description;

    try {
      // 프로젝트 생성
      const projectId = await repository.createProject(name, path, description);

      console.log("프로젝트가 성공적으로 생성되었습니다.");
      console.log(`프로젝트 ID: ${projectId}`);
      console.log(`프로젝트 이름: ${name}`);
      console.log(`프로젝트 경로: ${path}`);
      if (description) {
        console.log(`프로젝트 설명: ${description}`);
      }
      console.log("\n다음 명령어로 프로젝트 분석을 시작할 수 있습니다:");
      console.log(`bun src/index.ts --project_id=${projectId} --refresh`);

      // 환경 변수에 프로젝트 ID 설정
      process.env.PROJECT_ID = projectId;
    } catch (error) {
      console.error("프로젝트 생성 중 오류가 발생했습니다:");
      console.error(error);
      process.exit(1);
    }
  },
};

// 프로젝트 목록 조회 명령어
export const listProjectsCommand: CliCommand = {
  name: "list-projects",
  description: "저장된 프로젝트 목록을 조회합니다",
  async execute(args: string[]) {
    // 인자 파싱 옵션
    const options: ParseOptions = {
      flags: [],
      examples: ["bun src/index.ts list-projects"],
    };

    // 인자 파싱
    const parsedArgs = parseArgs(args, options);

    try {
      // 프로젝트 목록 조회
      const projects = await repository.getProjects();

      if (projects.length === 0) {
        console.log("저장된 프로젝트가 없습니다.");
        return;
      }

      console.log("프로젝트 목록:");

      for (const project of projects) {
        console.log(`\nID: ${project.id}`);
        console.log(`이름: ${project.name}`);
        console.log(`경로: ${project.path}`);
        if (project.description) {
          console.log(`설명: ${project.description}`);
        }
        if (project.lastCommitHash) {
          console.log(`마지막 분석 커밋: ${project.lastCommitHash}`);
        }
      }

      console.log("\n프로젝트 ID를 사용하여 MCP 서버 실행:");
      console.log("bun src/index.ts --project_id=<project_id>");

      console.log("\n프로젝트 분석 실행:");
      console.log("bun src/index.ts --project_id=<project_id> --refresh");
    } catch (error) {
      console.error("프로젝트 목록 조회 중 오류가 발생했습니다:");
      console.error(error);
      process.exit(1);
    }
  },
};

// 사용 가능한 명령어 목록
export const commands: CliCommand[] = [
  createProjectCommand,
  listProjectsCommand,
];

// 도움말 표시 함수
export function showHelp() {
  console.log("MCP Codebase CLI");
  console.log("\n사용 가능한 명령어:");

  for (const command of commands) {
    console.log(`\n  ${command.name}`);
    console.log(`    ${command.description}`);
  }

  console.log("\n자세한 명령어 사용법은 다음과 같이 확인할 수 있습니다:");
  console.log("  bun src/index.ts <명령어> --help");

  console.log("\n기존 MCP 사용법:");
  console.log("  MCP 서버 모드: bun src/index.ts --project_id <project_id>");
  console.log(
    "  새로고침 모드: bun src/index.ts --project_id <project_id> --refresh"
  );
}

// 명령어 실행 함수
export async function executeCommand(commandName: string, args: string[]) {
  // 도움말 요청인 경우
  if (args.includes("--help")) {
    const command = commands.find((cmd) => cmd.name === commandName);
    if (command) {
      // 명령어별 옵션 정의
      let options: ParseOptions = {};

      if (command.name === "create-project") {
        options = {
          requiredArgs: ["path"],
          optionalArgs: ["name", "description"],
          namedArgs: ["path", "name", "description"],
          descriptions: {
            path: "프로젝트 루트 디렉토리 경로 (절대 경로 또는 상대 경로)",
            name: "프로젝트 이름 (생략 시 경로의 마지막 디렉토리 이름으로 자동 설정)",
            description: "프로젝트에 대한 간단한 설명",
          },
          examples: [
            "bun src/index.ts create-project --path /path/to/project",
            'bun src/index.ts create-project --path /path/to/project --name "My Project"',
            'bun src/index.ts create-project --path ./my-project --name "My Project" --description "A sample project"',
          ],
        };
      } else if (command.name === "list-projects") {
        options = {
          examples: ["bun src/index.ts list-projects"],
        };
      }

      console.log(generateUsage(command.name, command.description, options));
    } else {
      showHelp();
    }
    return;
  }

  // 명령어 찾기
  const command = commands.find((cmd) => cmd.name === commandName);
  if (!command) {
    console.error(`오류: 알 수 없는 명령어 '${commandName}'`);
    showHelp();
    process.exit(1);
  }

  // 명령어 실행
  await command.execute(args);
}
