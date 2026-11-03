import { InterviewPage } from "@/components/interviews/interview-page";

// The transcript now shares a tab with the recording; old /transcript links still open it.
export const metadata = { title: "Interview · Recording & transcript" };

export default function Page(props: PageProps<"/interviews/[interviewId]/transcript">) {
  return <InterviewPage params={props.params} tab="recording" />;
}
