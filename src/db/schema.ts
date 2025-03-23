import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  vector,
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
export const codeChunks = pgTable("code_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  path: text("path").notNull(),
  code: text("code").notNull(),
  type: text("type", { enum: ["function", "class", "type"] }).notNull(),
  name: text("name").notNull(),
  lineStart: integer("line_start").notNull(),
  lineEnd: integer("line_end").notNull(),
  dependencies: jsonb("dependencies").$type<string[]>().default([]),
  dependents: jsonb("dependents").$type<string[]>().default([]),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 모델 타입 정의
export type Project = typeof projects.$inferSelect;

export type CodeChunk = typeof codeChunks.$inferSelect;
