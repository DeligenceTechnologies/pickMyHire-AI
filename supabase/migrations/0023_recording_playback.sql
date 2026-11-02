-- After an interview, a background worker joins each part's uploaded chunks
-- into one playable file (MP4 for video, M4A for the interviewer's voice) with
-- a duration and seek index, so recruiters stream it straight from storage.
-- Once the file is verified and a retention window has passed, the chunks are
-- deleted. Until the file is ready, playback falls back to the chunk stream.
alter table recordings
  add column playback_status text not null default 'pending'
    check (playback_status in ('pending', 'processing', 'ready', 'failed', 'skipped')),
  add column playback_path text,
  add column playback_mime text,
  add column playback_size bigint,
  add column playback_duration_ms integer,
  add column playback_error text,
  add column playback_attempts integer not null default 0,
  add column playback_started_at timestamptz,
  add column playback_ready_at timestamptz,
  add column chunks_purged_at timestamptz;

-- The worker's sweep: parts still waiting for a playable file…
create index recordings_playback_todo on recordings (updated_at)
  where status = 'stored' and playback_status in ('pending', 'processing', 'failed');
-- …and ready parts whose chunks are due for deletion.
create index recordings_chunks_to_purge on recordings (playback_ready_at)
  where status = 'stored' and playback_status = 'ready' and chunks_purged_at is null;
