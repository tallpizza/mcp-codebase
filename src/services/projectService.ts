import { CodeChunkRepository } from "./codeChunkRepository";
import { GitService } from "./gitService";
import { CodeChunkingService } from "./codeChunkingService";
import * as path from "path";
import * as fs from "fs";

export type CreateProjectParams = {
  name: string;
  path: string;
  description?: string;
};

export type ProjectAnalysisResult = {
  projectId: string;
  analyzedFiles: number;
  totalChunks: number;
  currentCommitHash?: string;
  changedFiles?: string[];
};

/**
 * 프로젝트 서비스 클래스
 * 프로젝트 생성, 조회, 분석 등의 기능을 제공합니다.
 */
export class ProjectService {
  private static instance: ProjectService;
  private repository: CodeChunkRepository;
  private gitService: GitService;

  private constructor() {
    this.repository = CodeChunkRepository.getInstance();
    this.gitService = GitService.getInstance();
  }

  /**
   * 싱글톤 인스턴스를 반환합니다.
   */
  public static getInstance(): ProjectService {
    if (!ProjectService.instance) {
      ProjectService.instance = new ProjectService();
    }
    return ProjectService.instance;
  }

  /**
   * 새 프로젝트를 생성합니다.
   * 경로가 유효한 Git 저장소인지 확인하고, 유효한 경우에만 프로젝트를 생성합니다.
   */
  public async createProject(params: CreateProjectParams): Promise<string> {
    // 경로가 존재하는지 확인
    if (!fs.existsSync(params.path)) {
      throw new Error(`지정된 경로가 존재하지 않습니다: ${params.path}`);
    }

    // 절대 경로로 변환
    const absolutePath = path.resolve(params.path);

    // Git 저장소인지 확인
    if (!this.gitService.isGitRepository(absolutePath)) {
      throw new Error(`지정된 경로는 Git 저장소가 아닙니다: ${absolutePath}`);
    }

    // 프로젝트 생성
    const projectId = await this.repository.createProject(
      params.name,
      absolutePath,
      params.description
    );

    // Git 커밋 해시 저장
    const commitHash = this.gitService.getCurrentCommitHash(absolutePath);
    if (commitHash) {
      await this.repository.updateProjectCommitHash(projectId, commitHash);
      console.error(`Git 커밋 해시 저장됨: ${commitHash}`);
    }

    return projectId;
  }

  /**
   * 모든 프로젝트 목록을 조회합니다.
   */
  public async listProjects() {
    return await this.repository.getProjects();
  }

  /**
   * 프로젝트 ID로 특정 프로젝트를 조회합니다.
   */
  public async getProject(projectId: string) {
    return await this.repository.getProject(projectId);
  }

  /**
   * 프로젝트를 분석하여 코드 청크를 생성합니다.
   * Git 저장소인 경우 마지막 분석 이후 변경된 파일만 선택적으로 분석합니다.
   */
  public async analyzeProject(
    projectId: string,
    forceRefresh = false
  ): Promise<ProjectAnalysisResult> {
    const project = await this.repository.getProject(projectId);

    if (!project) {
      throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }

    // Git 저장소 체크 및 변경사항 확인
    let filesToAnalyze: string[] | null = null;
    let changedFiles: string[] = [];
    let currentCommitHash: string | null = null;

    if (this.gitService.isGitRepository(project.path)) {
      console.error("Git 저장소 감지됨, 변경사항 확인 중...");
      const {
        changedFiles: changed,
        currentHash,
        hasChanges,
      } = await this.gitService.getProjectChangedFiles(projectId);

      changedFiles = changed;
      currentCommitHash = currentHash;

      // 변경사항이 없고 강제 새로고침도 아니면 분석 건너뛰기
      if (!hasChanges && !forceRefresh && project.lastCommitHash) {
        console.error("마지막 분석 이후 변경된 파일이 없습니다.");
        console.error("분석을 건너뛰고 현재 상태를 유지합니다.");

        // 커밋 해시 업데이트 (필요한 경우)
        if (currentCommitHash && currentCommitHash !== project.lastCommitHash) {
          await this.repository.updateProjectCommitHash(
            projectId,
            currentCommitHash
          );
          console.error(`Git 커밋 해시 업데이트됨: ${currentCommitHash}`);
        }

        // 현재 청크 수 조회
        const chunkCount = await this.repository.getProjectChunkCount(
          projectId
        );

        return {
          projectId,
          analyzedFiles: 0,
          totalChunks: chunkCount,
          currentCommitHash: currentCommitHash || undefined,
          changedFiles: undefined,
        };
      }

      // 강제 새로고침이 아니고 변경사항이 있는 경우에만 선택적 분석
      if (!forceRefresh && hasChanges) {
        if (project.lastCommitHash) {
          console.error(
            `마지막 분석 이후 ${changedFiles.length}개 파일이 변경되었습니다.`
          );
          // 변경된 파일만 분석하도록 설정
          filesToAnalyze = changedFiles;
        } else {
          console.error("첫 번째 분석입니다. 전체 프로젝트를 분석합니다.");
        }
      } else if (forceRefresh) {
        console.error("강제 새로고침 요청됨: 전체 프로젝트를 분석합니다.");
      } else {
        console.error("마지막 분석 이후 변경된 파일이 없습니다.");
        // 변경된 파일이 없더라도 새 파일이 추가되었을 수 있으므로 전체 분석 필요
        console.error("새 파일 검색을 위해 분석을 진행합니다...");
      }
    }

    // 프로젝트 코드베이스 청킹
    const chunkingService = new CodeChunkingService(project.path, project.id);
    await chunkingService.initialize();

    // 특정 파일만 분석할지 전체 프로젝트를 분석할지 결정
    let chunks;
    if (filesToAnalyze && !forceRefresh) {
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
    await this.repository.saveCodeChunks(chunks);

    // Git 커밋 해시 업데이트 (있는 경우)
    if (currentCommitHash) {
      await this.repository.updateProjectCommitHash(
        projectId,
        currentCommitHash
      );
      console.error(`Git 커밋 해시 업데이트됨: ${currentCommitHash}`);
    }

    return {
      projectId,
      analyzedFiles: new Set(chunks.map((c) => c.path)).size,
      totalChunks: chunks.length,
      currentCommitHash: currentCommitHash || undefined,
      changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
    };
  }

  /**
   * 프로젝트의 마지막 분석 커밋 해시를 업데이트합니다.
   */
  public async updateProjectCommitHash(
    projectId: string,
    hash: string
  ): Promise<void> {
    await this.repository.updateProjectCommitHash(projectId, hash);
  }

  /**
   * 프로젝트를 삭제합니다.
   * 프로젝트와 관련된 모든 코드 청크도 함께 삭제됩니다.
   */
  public async deleteProject(projectId: string): Promise<boolean> {
    // 프로젝트가 존재하는지 확인
    const project = await this.repository.getProject(projectId);
    if (!project) {
      throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }

    // 프로젝트 삭제 실행
    return await this.repository.deleteProject(projectId);
  }
}
