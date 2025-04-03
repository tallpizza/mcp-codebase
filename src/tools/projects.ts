import { Tool } from "../types/tool";
import { CodeChunkingService } from "../services/codeChunkingService";
import { CodeChunkRepository } from "../services/codeChunkRepository";
import { GitService } from "../services/gitService";
import * as path from "path";
import "dotenv/config";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";

const repository = CodeChunkRepository.getInstance();
const gitService = GitService.getInstance();

// 환경 변수에서 프로젝트 ID 가져오기
const getProjectId = () => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    throw new Error("PROJECT_ID 환경 변수가 설정되지 않았습니다");
  }
  return projectId;
};

// 프로젝트 ID 설정 - 새 프로젝트 생성 후 호출 권장
const setProjectId = async (projectId: string) => {
  console.error(`새 프로젝트 ID 설정: ${projectId}`);
  process.env.PROJECT_ID = projectId;
  console.error(`환경 변수 PROJECT_ID가 ${projectId}로 설정되었습니다.`);
};

export type CreateProjectArgs = {
  name: string;
  path: string;
  description?: string;
};

export type AnalyzeProjectArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};

export type CreateChunksArgs = {
  filePath: string;
};

export type ListProjectsArgs = {
  // 빈 타입 - 프로젝트 ID는 환경 변수에서 가져옴
};

// 프로젝트 생성 도구
const createProject: Tool<CreateProjectArgs> = {
  name: "create_project",
  description: "새로운 프로젝트를 생성합니다",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "프로젝트 이름",
      },
      path: {
        type: "string",
        description: "프로젝트 경로",
      },
      description: {
        type: "string",
        description: "프로젝트 설명",
      },
    },
    required: ["name", "path"],
  },
  async execute(args) {
    try {
      const projectId = await repository.createProject(
        args.name,
        args.path,
        args.description
      );

      // 프로젝트 ID 설정 안내
      await setProjectId(projectId);

      // Git 저장소인 경우 현재 커밋 해시 저장
      if (gitService.isGitRepository(args.path)) {
        const commitHash = gitService.getCurrentCommitHash(args.path);
        if (commitHash) {
          await repository.updateProjectCommitHash(projectId, commitHash);
          console.error(`Git 커밋 해시 저장됨: ${commitHash}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `프로젝트가 생성되었습니다.\n프로젝트 ID: ${projectId}\n\n이 ID를 사용하여 다른 명령을 실행하세요.\n환경 변수 PROJECT_ID=${projectId} 로 설정하면 이후 명령에서 자동으로 사용됩니다.`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 생성 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 프로젝트 목록 조회 도구
const listProjects: Tool<ListProjectsArgs> = {
  name: "list_projects",
  description: "저장된 프로젝트 목록을 조회합니다",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    try {
      const projects = await repository.getProjects();
      const currentProjectId = getProjectId();

      const projectsText = projects
        .map(
          (p) =>
            `${p.id === currentProjectId ? "* " : ""}${p.name} (${
              p.id
            })\n   경로: ${p.path}\n   설명: ${
              p.description || "없음"
            }\n   마지막 분석 커밋: ${p.lastCommitHash || "없음"}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `프로젝트 목록:\n\n${
              projectsText || "저장된 프로젝트가 없습니다"
            }\n\n* 현재 선택된 프로젝트`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 목록 조회 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 프로젝트 분석 도구
export const analyzeProject: Tool<AnalyzeProjectArgs> = {
  name: "analyze_project",
  description: "프로젝트의 코드를 분석하고 임베딩을 생성합니다",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    try {
      const projectId = getProjectId();

      const project = await repository.getProject(projectId);

      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      // Git 저장소 체크 및 변경사항 확인
      let filesToAnalyze: string[] | null = null;
      let changedFiles: string[] = [];
      let currentCommitHash: string | null = null;

      if (gitService.isGitRepository(project.path)) {
        console.error("Git 저장소 감지됨, 변경사항 확인 중...");
        const {
          changedFiles: changed,
          currentHash,
          hasChanges,
        } = await gitService.getProjectChangedFiles(projectId);

        changedFiles = changed;
        currentCommitHash = currentHash;

        if (hasChanges) {
          if (project.lastCommitHash) {
            console.error(
              `마지막 분석 이후 ${changedFiles.length}개 파일이 변경되었습니다.`
            );
            // 변경된 파일만 분석하도록 설정
            filesToAnalyze = changedFiles;
          } else {
            console.error("첫 번째 분석입니다. 전체 프로젝트를 분석합니다.");
          }
        } else {
          console.error("마지막 분석 이후 변경된 파일이 없습니다.");
          // 변경된 파일이 없으면 새 파일만 추가
          console.error("새 파일만 추가합니다...");
        }
      }

      // 프로젝트 코드베이스 청킹
      const chunkingService = new CodeChunkingService(project.path, project.id);
      await chunkingService.initialize();

      // 특정 파일만 분석할지 전체 프로젝트를 분석할지 결정
      let chunks;
      if (filesToAnalyze) {
        // 변경된 파일만 청킹
        console.error("변경된 파일만 분석합니다...");
        chunks = [];
        for (const filePath of filesToAnalyze) {
          const relativeFilePath = path.relative(project.path, filePath);
          console.error(`파일 분석 중: ${relativeFilePath}`);
          try {
            const fileChunks = await chunkingService.chunkFile(filePath);
            chunks.push(...fileChunks);
          } catch (error) {
            console.error(`파일 분석 중 오류 발생: ${filePath}`, error);
            // 개별 파일 오류는 무시하고 계속 진행
          }
        }
      } else {
        // 전체 프로젝트 청킹
        console.error("전체 프로젝트를 분석합니다...");
        chunks = await chunkingService.chunkEntireProject();
      }

      // 청크 저장
      await repository.saveCodeChunks(chunks);

      // Git 커밋 해시 업데이트 (있는 경우)
      if (currentCommitHash) {
        await repository.updateProjectCommitHash(projectId, currentCommitHash);
        console.error(`Git 커밋 해시 업데이트됨: ${currentCommitHash}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `프로젝트 분석이 완료되었습니다.\n- 생성된 코드 청크: ${
              chunks.length
            }개${
              changedFiles.length > 0
                ? `\n- 변경된 파일: ${changedFiles.length}개`
                : ""
            }${currentCommitHash ? `\n- 커밋 해시: ${currentCommitHash}` : ""}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `프로젝트 분석 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 코드 청크 생성 도구
const createChunks: Tool<CreateChunksArgs> = {
  name: "create_code_chunks",
  description: "파일의 코드를 분석하여 청크를 생성합니다",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "분석할 파일 경로",
      },
    },
    required: ["filePath"],
  },
  async execute(args) {
    try {
      const projectId = getProjectId();

      const project = await repository.getProject(projectId);
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      // 파일 경로 확인
      const fullPath = path.isAbsolute(args.filePath)
        ? args.filePath
        : path.join(project.path, args.filePath);

      // 청킹 서비스 초기화 및 파일 분석
      const chunkingService = new CodeChunkingService(project.path, project.id);
      await chunkingService.initialize();
      const chunks = await chunkingService.chunkFile(fullPath);

      // 청크 저장
      await repository.saveCodeChunks(chunks);

      return {
        content: [
          {
            type: "text",
            text: `파일 분석이 완료되었습니다.\n- 파일: ${args.filePath}\n- 생성된 코드 청크: ${chunks.length}개`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `파일 분석 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 내보낼 도구 목록
export const projectTools = [];
