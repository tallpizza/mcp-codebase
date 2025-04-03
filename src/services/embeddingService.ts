import OpenAI from "openai";
import "dotenv/config";

export class EmbeddingService {
  private openai: OpenAI;
  private batchSize: number = 300; // 한 번에 처리할 임베딩 개수

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 단일 텍스트에 대한 임베딩 생성
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // 입력 유효성 검사
      if (!text || typeof text !== "string") {
        throw new Error("유효한 텍스트가 필요합니다");
      }

      if (text.trim() === "") {
        throw new Error("비어있지 않은 텍스트가 필요합니다");
      }

      // 로깅
      console.error(`임베딩 생성 요청: 텍스트 길이=${text.length}`);

      // API 키 확인
      if (!this.openai || !process.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API 키가 설정되지 않았습니다");
      }

      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });

      if (
        !response ||
        !response.data ||
        !response.data[0] ||
        !response.data[0].embedding
      ) {
        throw new Error("OpenAI API에서 유효한 임베딩 응답을 받지 못했습니다");
      }

      // 로깅
      console.error(
        `임베딩 생성 성공: 차원=${response.data[0].embedding.length}`
      );
      return response.data[0].embedding;
    } catch (error) {
      // 자세한 오류 로깅
      console.error("임베딩 생성 오류:", error);
      if (error instanceof Error) {
        console.error("오류 스택:", error.stack);
      }
      // 오류 재전파
      throw new Error(
        `임베딩 생성 실패: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 여러 텍스트에 대한 임베딩을 배치로 생성 (병렬 처리)
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    try {
      // 빈 문자열 필터링
      const validTexts = texts.filter((text) => text && text.length > 0);

      if (validTexts.length === 0) {
        return [];
      }

      const batches: string[][] = [];

      // 배치 사이즈로 텍스트 분할
      for (let i = 0; i < validTexts.length; i += this.batchSize) {
        batches.push(validTexts.slice(i, i + this.batchSize));
      }

      // 각 배치에 대해 병렬로 임베딩 요청 생성
      const batchPromises = batches.map(async (batch, index) => {
        const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: batch,
          encoding_format: "float",
        });

        const batchEmbeddings = response.data.map(
          (item: { embedding: number[] }) => item.embedding
        );

        return batchEmbeddings;
      });

      // 모든 배치 요청 병렬 처리 후 결과 합치기
      const embeddingsArrays = await Promise.all(batchPromises);
      const embeddings = embeddingsArrays.flat();

      return embeddings;
    } catch (error) {
      console.error("배치 임베딩 생성 오류:", error);
      throw error;
    }
  }

  /**
   * 코드 임베딩을 위한 전처리 수행
   */
  preprocessCodeForEmbedding(code: string, filePath?: string): string {
    if (!code || typeof code !== "string") {
      return "";
    }

    try {
      // 주석 제거
      let processed = code.replace(/\/\/.*$/gm, "");
      processed = processed.replace(/\/\*[\s\S]*?\*\//g, "");

      // 연속된 공백 제거
      processed = processed.replace(/\s+/g, " ");

      // 앞뒤 공백 제거
      processed = processed.trim();

      // 파일 경로 정보 추가
      if (filePath) {
        processed = `File: ${filePath}\n\nCode:\n${processed}`;
      }

      // 최소 길이 확인
      if (processed.length < 1) {
        return "";
      }

      // 최대 길이 제한 (OpenAI API 제한)
      if (processed.length > 8000) {
        processed = processed.slice(0, 8000);
      }

      return processed;
    } catch (error) {
      console.error("코드 전처리 중 오류:", error);
      return "";
    }
  }

  /**
   * 쿼리 텍스트 임베딩 생성
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query);
  }
}
