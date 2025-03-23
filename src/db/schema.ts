import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  vector,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 프로젝트 테이블
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 코드 청크 테이블
export const codeChunks = pgTable(
  "code_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    path: text("path").notNull(),
    code: text("code").notNull(),
    type: text("type", {
      enum: ["function", "class", "type", "constant"],
    }).notNull(),
    name: text("name").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    dependencies: jsonb("dependencies").$type<string[]>().default([]),
    dependents: jsonb("dependents").$type<string[]>().default([]),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => {
    return {
      // 고유 인덱스 추가: 프로젝트 ID, 파일 경로, 심볼 이름의 조합은 고유해야 함
      chunkUniqueIdx: uniqueIndex("chunk_unique_idx").on(
        table.projectId,
        table.path,
        table.name
      ),
    };
  }
);

// 모델 타입 정의
export type Project = typeof projects.$inferSelect;

export type CodeChunk = typeof codeChunks.$inferSelect;
