import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { CodeChunkRepository } from "./codeChunkRepository";

/**
 * Git 관련 서비스를 제공하는 클래스
 * - 로컬 Git 저장소의 커밋 해시 추적
 * - 변경된 파일 감지
 * - 프로젝트별 마지막 커밋 해시 관리
 */
export class GitService {
  private static instance: GitService | null = null;
  private repository: CodeChunkRepository;

  /**
   * 생성자 - 싱글톤 패턴을 위해 private으로 선언
   */
  private constructor() {
    this.repository = CodeChunkRepository.getInstance();
  }

  /**
   * 싱글톤 인스턴스 반환
   * @returns GitService 인스턴스
   */
  public static getInstance(): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService();
    }
    return GitService.instance;
  }

  /**
   * 디렉토리가 Git 저장소인지 확인
   * @param directory 확인할 디렉토리 경로
   * @returns Git 저장소 여부
   */
  public isGitRepository(directory: string): boolean {
    try {
      const gitDir = path.join(directory, ".git");
      return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * 현재 Git 저장소의 HEAD 커밋 해시 가져오기
   * @param directory Git 저장소 경로
   * @returns HEAD 커밋 해시 (없으면 null)
   */
  public getCurrentCommitHash(directory: string): string | null {
    try {
      if (!this.isGitRepository(directory)) {
        return null;
      }

      // Git 명령어 실행하여 현재 커밋 해시 가져오기
      const command = `git -C "${directory}" rev-parse HEAD`;
      const commitHash = execSync(command).toString().trim();
      return commitHash;
    } catch (error) {
      console.error("Git 커밋 해시 가져오기 실패:", error);
      return null;
    }
  }

  /**
   * 특정 프로젝트의 마지막으로 분석된 커밋 해시 가져오기
   * @param projectId 프로젝트 ID
   * @returns 마지막 커밋 해시 (없으면 null)
   */
  public async getLastAnalyzedCommitHash(
    projectId: string
  ): Promise<string | null> {
    try {
      const project = await this.repository.getProject(projectId);
      if (!project || !project.lastCommitHash) {
        return null;
      }
      return project.lastCommitHash;
    } catch (error) {
      console.error("마지막 분석 커밋 해시 가져오기 실패:", error);
      return null;
    }
  }

  /**
   * 현재 커밋 해시를 프로젝트의 마지막 분석 커밋 해시로 저장
   * @param projectId 프로젝트 ID
   * @param commitHash 커밋 해시
   */
  public async updateLastAnalyzedCommitHash(
    projectId: string,
    commitHash: string
  ): Promise<void> {
    try {
      await this.repository.updateProjectCommitHash(projectId, commitHash);
    } catch (error) {
      console.error("커밋 해시 업데이트 실패:", error);
      throw error;
    }
  }

  /**
   * 두 커밋 사이에 변경된 파일 목록 가져오기
   * @param directory Git 저장소 경로
   * @param oldCommitHash 이전 커밋 해시
   * @param newCommitHash 새 커밋 해시 (기본값: HEAD)
   * @returns 변경된 파일 경로 목록
   */
  public getChangedFiles(
    directory: string,
    oldCommitHash: string,
    newCommitHash: string = "HEAD"
  ): string[] {
    try {
      if (!this.isGitRepository(directory)) {
        return [];
      }

      // Git 명령어 실행하여 변경된 파일 목록 가져오기
      const command = `git -C "${directory}" diff --name-only ${oldCommitHash} ${newCommitHash}`;
      const output = execSync(command).toString().trim();

      // 결과가 비어있으면 빈 배열 반환
      if (!output) {
        return [];
      }

      // 파일 목록으로 분할하고 프로젝트 루트 기준 경로로 변환
      return output.split("\n").map((file) => path.join(directory, file));
    } catch (error) {
      console.error("변경된 파일 목록 가져오기 실패:", error);
      return [];
    }
  }

  /**
   * 프로젝트의 변경된 파일 목록 가져오기
   * - 마지막 분석 커밋과 현재 HEAD 사이에 변경된 파일 감지
   * @param projectId 프로젝트 ID
   * @returns 변경된 파일 목록, 현재 커밋 해시, 변경 여부
   */
  public async getProjectChangedFiles(projectId: string): Promise<{
    changedFiles: string[];
    currentHash: string | null;
    hasChanges: boolean;
  }> {
    try {
      // 프로젝트 정보 가져오기
      const project = await this.repository.getProject(projectId);
      if (!project) {
        throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
      }

      // 프로젝트 디렉토리가 Git 저장소인지 확인
      if (!this.isGitRepository(project.path)) {
        return { changedFiles: [], currentHash: null, hasChanges: false };
      }

      // 현재 커밋 해시 가져오기
      const currentHash = this.getCurrentCommitHash(project.path);
      if (!currentHash) {
        return { changedFiles: [], currentHash: null, hasChanges: false };
      }

      // 마지막 분석 커밋 해시 가져오기
      const lastHash = project.lastCommitHash;

      // 마지막 분석 커밋이 없거나 현재 커밋과 같으면 변경 없음
      if (!lastHash) {
        return { changedFiles: [], currentHash, hasChanges: true };
      }

      if (lastHash === currentHash) {
        return { changedFiles: [], currentHash, hasChanges: false };
      }

      // 변경된 파일 목록 가져오기
      const changedFiles = this.getChangedFiles(
        project.path,
        lastHash,
        currentHash
      );
      return { changedFiles, currentHash, hasChanges: changedFiles.length > 0 };
    } catch (error) {
      console.error("프로젝트 변경 파일 감지 실패:", error);
      return { changedFiles: [], currentHash: null, hasChanges: false };
    }
  }

  /**
   * 특정 확장자만 필터링하여 변경된 파일 목록 반환
   * @param files 변경된 파일 목록
   * @param extensions 필터링할 확장자 목록 (예: ['.ts', '.js'])
   * @returns 필터링된 파일 목록
   */
  public filterFilesByExtension(
    files: string[],
    extensions: string[]
  ): string[] {
    return files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return extensions.includes(ext);
    });
  }
}
