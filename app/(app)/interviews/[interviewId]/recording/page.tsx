import { InterviewPage } from "@/components/interviews/interview-page";

export const metadata = { title: "Interview · Recording & transcript" };

export default function Page(props: PageProps<"/interviews/[interviewId]/recording">) {
  return <InterviewPage params={props.params} tab="recording" />;
}
