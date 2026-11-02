"use client";

import { Download, FileText, Mic, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { RecordingPart } from "./video-player";

const safe = (s: string) => s.replace(/[^\w .-]+/g, "").trim();
const ext = (mime: string) => (mime === "audio/mp4" ? "m4a" : mime.includes("mp4") ? "mp4" : "webm");

function save(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // same-origin streams honour this; signed storage links open in a new tab instead
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download the transcript, the candidate's video and the interviewer's voice. */
export function DownloadMenu({ interviewId, name, parts, voice }: { interviewId: string; name: string; parts: RecordingPart[] | null; voice: RecordingPart[] | null }) {
  const base = safe(name);
  const label = (kind: string, list: RecordingPart[], i: number) => `${kind}${list.length > 1 ? ` (part ${i + 1})` : ""}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download /> Download
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => save(`/api/interviews/${interviewId}/transcript/download`, `${base} - transcript.txt`)}>
          <FileText /> Transcript (.txt)
        </DropdownMenuItem>
        {parts?.map((p, i) => (
          <DropdownMenuItem key={p.url} onClick={() => save(p.url, `${base} - candidate video${parts.length > 1 ? ` ${i + 1}` : ""}.${ext(p.mime_type)}`)}>
            <Video /> {label("Candidate video", parts, i)}
          </DropdownMenuItem>
        ))}
        {voice?.map((p, i) => (
          <DropdownMenuItem key={p.url} onClick={() => save(p.url, `${base} - interviewer voice${voice.length > 1 ? ` ${i + 1}` : ""}.${ext(p.mime_type)}`)}>
            <Mic /> {label("Interviewer voice", voice, i)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
