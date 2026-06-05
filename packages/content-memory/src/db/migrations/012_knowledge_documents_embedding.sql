-- Document-level embedding for semantic retrieval (nullable; lexical search still works without it).
ALTER TABLE knowledge_documents ADD COLUMN embedding BLOB;
