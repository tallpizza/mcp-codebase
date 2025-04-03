import { Tool } from "../types/tool";
import { projects } from "../db/schema";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import { ProjectService } from "../services/projectService";
import { GitService } from "../services/gitService";
import * as path from "path";

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

// 서비스 인스턴스
const repository = CodeChunkRepository.getInstance();
const projectService = ProjectService.getInstance();
const gitService = GitService.getInstance();

// 프로젝트 생성 명령어
export const createProjectCommand: CliCommand = {
  name: "create-project",
  description: "새로운 프로젝트를 생성합니다 (Git 저장소만 지원)",
  async execute(args: string[]) {
    // 인자 파싱 옵션
    const options: ParseOptions = {
      requiredArgs: ["path"],
      optionalArgs: ["name", "description"],
      flags: [],
      namedArgs: ["path", "name", "description"],
      descriptions: {
        path: "프로젝트 루트 디렉토리 경로 (절대 경로 또는 상대 경로, Git 저장소여야 함)",
        name: "프로젝트 이름 (생략 시 경로의 마지막 디렉토리 이름으로 자동 설정)",
        description: "프로젝트에 대한 간단한 설명",
      },
      examples: [
        "bun src/index.ts create-project --path /path/to/git/project",
        'bun src/index.ts create-project --path /path/to/git/project --name "My Project"',
        'bun src/index.ts create-project --path ./my-git-project --name "My Project" --description "A sample Git project"',
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
    const projectPath = parsedArgs.named.path;

    // 프로젝트 이름이 제공되지 않은 경우 경로에서 유추 (마지막 디렉토리 이름)
    let name = parsedArgs.named.name;
    if (!name) {
      // 경로의 끝에 있는 슬래시 제거
      const cleanPath = projectPath.endsWith("/")
        ? projectPath.slice(0, -1)
        : projectPath;
      // 마지막 디렉토리 이름 추출
      name = cleanPath.split("/").pop() || "unnamed-project";
    }

    // 설명 (선택 사항)
    const description = parsedArgs.named.description;

    try {
      console.log(`프로젝트 생성 중: ${name} (경로: ${projectPath})`);

      // 프로젝트 서비스를 통해 생성
      const projectId = await projectService.createProject({
        name,
        path: projectPath,
        description,
      });

      console.log("프로젝트가 성공적으로 생성되었습니다!");
      console.log(`- 프로젝트 ID: ${projectId}`);
      console.log(`- 이름: ${name}`);
      console.log(`- 경로: ${path.resolve(projectPath)}`);
      if (description) {
        console.log(`- 설명: ${description}`);
      }

      console.log(
        "\n다음 명령으로 MCP 서버 실행 시 이 프로젝트를 사용할 수 있습니다:"
      );
      console.log(`PROJECT_ID=${projectId} bun src/index.ts`);

      console.log("\n또는 다음 명령으로 프로젝트 분석을 실행할 수 있습니다:");
      console.log(`bun src/index.ts analyze-project --project_id ${projectId}`);
    } catch (error: any) {
      console.error(`오류: ${error.message}`);

      // Git 저장소 관련 오류인 경우 도움말 표시
      if (error.message.includes("Git 저장소가 아닙니다")) {
        console.error("\n지정한 경로는 Git 저장소가 아닙니다.");
        console.error(
          "프로젝트 생성을 위해서는 유효한 Git 저장소가 필요합니다."
        );
        console.error("다음 명령으로 새 Git 저장소를 초기화할 수 있습니다:");
        console.error(
          `  cd ${projectPath} && git init && git add . && git commit -m "Initial commit"`
        );
      }

      process.exit(1);
    }
  },
};

// 프로젝트 분석 명령어
export const analyzeProjectCommand: CliCommand = {
  name: "analyze-project",
  description: "프로젝트의 코드를 분석하고 임베딩을 생성합니다",
  async execute(args: string[]) {
    // 인자 파싱 옵션
    const options: ParseOptions = {
      requiredArgs: ["project_id"],
      optionalArgs: [],
      flags: ["refresh"],
      namedArgs: ["project_id"],
      descriptions: {
        project_id: "분석할 프로젝트의 ID",
        refresh: "전체 프로젝트를 강제로 재분석 (Git 변경사항 감지 무시)",
      },
      examples: [
        "bun src/index.ts analyze-project --project_id <project_id>",
        "bun src/index.ts analyze-project --project_id <project_id> --refresh",
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

    const projectId = parsedArgs.named.project_id;
    const refresh = parsedArgs.flags.refresh;

    try {
      // 환경변수에 프로젝트 ID 설정 (도구에서 사용하기 위함)
      process.env.PROJECT_ID = projectId;

      console.log(
        `프로젝트 분석 시작: ${projectId}${refresh ? " (강제 재분석)" : ""}`
      );

      // 프로젝트 존재 여부 확인
      const project = await projectService.getProject(projectId);
      if (!project) {
        console.error(`오류: 프로젝트를 찾을 수 없습니다 (ID: ${projectId})`);
        process.exit(1);
      }

      console.log(`분석 중인 프로젝트: ${project.name} (${project.path})`);
      console.log(
        "분석 진행 중... 이 작업은 프로젝트 크기에 따라 수 분이 걸릴 수 있습니다."
      );

      // 프로젝트 분석 실행
      const result = await projectService.analyzeProject(projectId, refresh);

      console.log("\n분석이 완료되었습니다!");
      console.log(`- 프로젝트 ID: ${result.projectId}`);
      console.log(`- 분석된 파일 수: ${result.analyzedFiles}`);
      console.log(`- 생성된 코드 청크 수: ${result.totalChunks}`);

      if (result.currentCommitHash) {
        console.log(`- 현재 Git 커밋 해시: ${result.currentCommitHash}`);
      }

      if (result.changedFiles && result.changedFiles.length > 0) {
        console.log(
          `\n마지막 분석 이후 ${result.changedFiles.length}개 파일이 변경되었습니다.`
        );

        // 처음 5개 파일만 표시
        const maxFilesToShow = 5;
        const limitedFiles = result.changedFiles.slice(0, maxFilesToShow);
        const remainingCount = result.changedFiles.length - maxFilesToShow;

        limitedFiles.forEach((file) => {
          console.log(`- ${file}`);
        });

        if (remainingCount > 0) {
          console.log(`...외 ${remainingCount}개 파일`);
        }
      }

      console.log(
        "\nMCP 서버를 사용하여 프로젝트 코드를 검색하려면 다음 명령을 실행하세요:"
      );
      console.log(`PROJECT_ID=${projectId} bun src/index.ts`);
    } catch (error: any) {
      console.error(`프로젝트 분석 중 오류가 발생했습니다: ${error.message}`);
      process.exit(1);
    }
  },
};

// 프로젝트 목록 조회 명령어
export const listProjectsCommand: CliCommand = {
  name: "list-projects",
  description: "저장된 프로젝트 목록을 조회합니다",
  async execute(args: string[]) {
    try {
      const projects = await projectService.listProjects();

      console.log("프로젝트 목록:\n");

      projects.forEach((project) => {
        console.log(`ID: ${project.id}`);
        console.log(`이름: ${project.name}`);
        console.log(`경로: ${project.path}`);
        if (project.description) {
          console.log(`설명: ${project.description}`);
        }
        if (project.lastCommitHash) {
          console.log(`마지막 분석 커밋: ${project.lastCommitHash}`);
        }
        console.log("");
      });

      // 사용 안내 메시지 업데이트
      console.log("프로젝트 ID를 사용하여 MCP 서버 실행:");
      console.log("PROJECT_ID=<project_id> bun src/index.ts");
      console.log("");
      console.log("프로젝트 분석 실행:");
      console.log("PROJECT_ID=<project_id> bun src/index.ts --refresh");
      console.log("또는");
      console.log("bun src/index.ts analyze-project --project_id=<project_id>");
    } catch (error) {
      console.error("프로젝트 목록 조회 중 오류 발생:", error);
      process.exit(1);
    }
  },
};

// delete-project 명령어 - 프로젝트 삭제
export const deleteProjectCommand: CliCommand = {
  name: "delete-project",
  description: "프로젝트와 관련된 모든 코드 청크를 삭제합니다",
  async execute(args: string[]) {
    // 인자 파싱 옵션
    const options: ParseOptions = {
      requiredArgs: ["project_id"],
      namedArgs: ["project_id"],
      flags: ["force"],
      descriptions: {
        project_id: "삭제할 프로젝트 ID",
        force: "확인 없이 강제로 삭제",
      },
      examples: [
        "bun src/index.ts delete-project --project_id <project_id>",
        "bun src/index.ts delete-project --project_id <project_id> --force",
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

    const projectId = parsedArgs.named.project_id;
    const force = parsedArgs.flags.force;

    try {
      // 프로젝트 정보 조회
      const projectService = ProjectService.getInstance();
      const project = await projectService.getProject(projectId);

      if (!project) {
        console.error(`오류: 프로젝트를 찾을 수 없습니다: ${projectId}`);
        process.exit(1);
      }

      // 강제 삭제가 아니면 확인 요청
      if (!force) {
        console.log(`다음 프로젝트를 삭제하시겠습니까?`);
        console.log(`- ID: ${project.id}`);
        console.log(`- 이름: ${project.name}`);
        console.log(`- 경로: ${project.path}`);
        if (project.description) {
          console.log(`- 설명: ${project.description}`);
        }
        console.log(
          `\n이 작업은 되돌릴 수 없으며, 모든 코드 청크가 삭제됩니다.`
        );
        console.log(`계속하려면 프로젝트 ID를 다시 입력하세요: `);

        // 사용자 입력 (이 부분은 실제로는 readline 모듈을 사용하여 구현해야 하지만
        // 여기서는 force 옵션을 사용하도록 안내)
        console.log(`\n확인 없이 삭제하려면 --force 플래그를 사용하세요.`);
        process.exit(0);
      }

      // 프로젝트 삭제 실행
      console.log(`프로젝트 삭제 중: ${project.name} (${projectId})`);
      const result = await projectService.deleteProject(projectId);

      if (result) {
        console.log(`프로젝트가 성공적으로 삭제되었습니다!`);
      } else {
        console.error(`프로젝트 삭제에 실패했습니다.`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`프로젝트 삭제 중 오류가 발생했습니다:`, error);
      process.exit(1);
    }
  },
};

// 도움말 표시 함수
export function showHelp() {
  console.log("MCP 코드베이스 CLI");
  console.log("\n사용 가능한 명령어:");
  console.log("  create-project    새로운 프로젝트 생성");
  console.log("  list-projects     저장된 프로젝트 목록 조회");
  console.log("  analyze-project   프로젝트 분석 및 임베딩 생성");
  console.log("  delete-project    프로젝트와 관련된 모든 코드 청크를 삭제");
  console.log("\n자세한 도움말은 다음과 같이 입력하세요:");
  console.log("  bun src/index.ts <명령어> --help");
}

// 사용 가능한 모든 명령어 목록
export const commands: CliCommand[] = [
  createProjectCommand,
  listProjectsCommand,
  analyzeProjectCommand,
  deleteProjectCommand,
];

// 명령어 실행 함수
export async function executeCommand(commandName: string, args: string[]) {
  // 도움말 요청인 경우
  if (args.includes("--help")) {
    const command = commands.find((cmd) => cmd.name === commandName);
    if (command) {
      // 각 명령어의 도움말 표시
      console.log(
        generateUsage(command.name, command.description, {
          // 기본 옵션으로 도움말 생성
          // 실제 구현은 각 명령어의 execute 함수에서 자세한 옵션 제공
        })
      );
      return;
    }
  }

  // 명령어 찾기
  const command = commands.find((cmd) => cmd.name === commandName);
  if (!command) {
    console.error(`알 수 없는 명령어: ${commandName}`);
    showHelp();
    process.exit(1);
  }

  // 명령어 실행
  await command.execute(args);
}
