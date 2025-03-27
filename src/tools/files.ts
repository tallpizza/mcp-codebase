import { Tool } from "../types/tool";
import { db } from "../db";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import * as path from "path";
import * as fs from "fs/promises";

// 환경 변수에서 프로젝트 ID 가져오기
const getProjectId = () => {
  const projectId = process.env.PROJECT_ID;
  if (!projectId) {
    throw new Error("PROJECT_ID 환경 변수가 설정되지 않았습니다");
  }
  return projectId;
};

export type ListFilesArgs = {
  directory?: string;
};

export type ReadFileArgs = {
  filePath: string;
};

export type WriteFileArgs = {
  filePath: string;
  content: string;
};

export type DeleteFileArgs = {
  filePath: string;
};

// 파일 목록 조회 도구
const listFiles: Tool<ListFilesArgs> = {
  name: "mcp_files_list",
  description: "프로젝트 내 파일 목록을 반환합니다",
  inputSchema: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "조회할 디렉토리 경로",
      },
    },
    required: [],
  },
  async execute(args) {
    try {
      const projectId = getProjectId();

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      const targetDir = args.directory
        ? path.join(project.path, args.directory)
        : project.path;

      const files = await fs.readdir(targetDir, { withFileTypes: true });
      const fileList = files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        path: path.relative(project.path, path.join(targetDir, file.name)),
      }));

      return {
        content: [
          {
            type: "text",
            text: fileList
              .map((f) => `${f.isDirectory ? "📁" : "📄"} ${f.path}`)
              .join("\n"),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `파일 목록 조회 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 파일 읽기 도구
const readFile: Tool<ReadFileArgs> = {
  name: "mcp_files_read",
  description: "프로젝트 내 파일 내용을 읽습니다",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "파일 경로",
      },
    },
    required: ["filePath"],
  },
  async execute(args) {
    try {
      const projectId = getProjectId();

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      const targetPath = path.join(project.path, args.filePath);
      if (!targetPath.startsWith(project.path)) {
        throw new Error("프로젝트 경로를 벗어난 접근입니다");
      }

      const content = await fs.readFile(targetPath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `파일 읽기 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 파일 쓰기 도구
const writeFile: Tool<WriteFileArgs> = {
  name: "mcp_files_write",
  description: "프로젝트 내 파일을 생성하거나 수정합니다",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "파일 경로",
      },
      content: {
        type: "string",
        description: "파일 내용",
      },
    },
    required: ["filePath", "content"],
  },
  async execute(args: WriteFileArgs) {
    try {
      const projectId = getProjectId();

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      const targetPath = path.join(project.path, args.filePath);
      if (!targetPath.startsWith(project.path)) {
        throw new Error("프로젝트 경로를 벗어난 접근입니다");
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, args.content, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `파일이 저장되었습니다: ${args.filePath}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `파일 쓰기 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

// 파일 삭제 도구
const deleteFile: Tool<DeleteFileArgs> = {
  name: "mcp_files_delete",
  description: "프로젝트 내 파일을 삭제합니다",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "파일 경로",
      },
    },
    required: ["filePath"],
  },
  async execute(args: DeleteFileArgs) {
    try {
      const projectId = getProjectId();

      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));

      const project = projectList[0];
      if (!project) {
        throw new Error("프로젝트를 찾을 수 없습니다");
      }

      const targetPath = path.join(project.path, args.filePath);
      if (!targetPath.startsWith(project.path)) {
        throw new Error("프로젝트 경로를 벗어난 접근입니다");
      }

      await fs.unlink(targetPath);
      return {
        content: [
          {
            type: "text",
            text: `파일이 삭제되었습니다: ${args.filePath}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `파일 삭제 중 오류가 발생했습니다: ${error.message}`,
          },
        ],
      };
    }
  },
};

export const fileTools = [listFiles, readFile, writeFile, deleteFile];
