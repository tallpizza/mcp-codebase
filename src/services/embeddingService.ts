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
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("임베딩 생성 오류:", error);
      throw error;
    }
  }

  /**
   * 여러 텍스트에 대한 임베딩을 배치로 생성 (병렬 처리)
   * @param texts 임베딩을 생성할 텍스트 배열
   * @returns 각 텍스트에 대한 임베딩 배열
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    try {
      const batches: string[][] = [];

      // 배치 사이즈로 텍스트 분할
      for (let i = 0; i < texts.length; i += this.batchSize) {
        batches.push(texts.slice(i, i + this.batchSize));
      }

      console.log(
        `${texts.length}개의 텍스트를 ${batches.length}개 배치로 처리합니다.`
      );

      // 각 배치에 대해 병렬로 임베딩 요청 생성
      const batchPromises = batches.map(async (batch, index) => {
        console.log(
          `배치 ${index + 1}/${batches.length} 요청 시작... (${
            batch.length
          }개 항목)`
        );

        const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: batch,
          encoding_format: "float",
        });

        const batchEmbeddings = response.data.map(
          (item: { embedding: number[] }) => item.embedding
        );

        console.log(
          `배치 ${index + 1}/${batches.length} 완료. ${
            batchEmbeddings.length
          }개 임베딩 생성됨.`
        );

        return batchEmbeddings;
      });

      // 모든 배치 요청 병렬 처리 후 결과 합치기
      const embeddingsArrays = await Promise.all(batchPromises);
      const embeddings = embeddingsArrays.flat();

      console.log(`총 ${embeddings.length}개 임베딩 병렬 처리 완료`);
      return embeddings;
    } catch (error) {
      console.error("배치 임베딩 생성 오류:", error);
      throw error;
    }
  }

  /**
   * 코드 임베딩을 위한 전처리 수행
   */
  preprocessCodeForEmbedding(code: string): string {
    // 주석 제거
    code = code.replace(/\/\/.*$/gm, "");
    code = code.replace(/\/\*[\s\S]*?\*\//g, "");

    // 연속된 공백 제거
    code = code.replace(/\s+/g, " ");

    // 앞뒤 공백 제거
    code = code.trim();

    return code;
  }

  /**
   * 쿼리 텍스트 임베딩 생성
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query);
  }
}
