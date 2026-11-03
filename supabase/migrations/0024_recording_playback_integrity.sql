-- Ties each playable file to the exact chunks it was encoded from.
--
-- The browser can still be uploading the last chunks when an interview is
-- closed, so a part may get more chunks after its file was encoded. Recording
-- how many chunks (and bytes) went into the file lets the app see that the file
-- is out of date: it plays the chunks instead, encodes the part again, and never
-- deletes chunks that aren't in the file.
--
-- `chunks_received` / `file_size` are kept up to date on every chunk upload
-- (same row, same transaction), so comparing them with these columns is exact.
alter table recordings
  add column playback_chunks integer,
  add column playback_source_bytes bigint;

-- Files encoded before this migration have no record of their chunks. They
-- keep playing as before; parts whose chunks are still kept are encoded again
-- in the background (the file may be missing the last chunks) and their chunks
-- are only deleted after that. Parts whose chunks were already deleted keep their file.
update recordings
  set playback_chunks = chunks_received, playback_source_bytes = file_size
  where playback_status = 'ready' and chunks_purged_at is not null;
