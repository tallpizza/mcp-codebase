ALTER TABLE "code_chunks" ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_commit_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chunk_unique_idx" ON "code_chunks" USING btree ("project_id","path","name");