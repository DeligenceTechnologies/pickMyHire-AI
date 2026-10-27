/** The short demo, and the full-length product walkthrough (served from /public/demo). */
export const DEMO_VIDEO = { src: "/demo/pickmyhire-ai-demo.mp4", poster: "/demo/poster.webp", minutes: 4 };
export const WALKTHROUGH_VIDEO = { src: "/demo/pickmyhire-ai-walkthrough-11min.mp4", poster: "/demo/poster-11min.webp", minutes: 11 };

export function DemoVideo({ className = "", video = DEMO_VIDEO }: { className?: string; video?: { src: string; poster: string } }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-[#DCE4F0] bg-[#0B0F19] shadow-[0_24px_60px_-20px_rgba(11,30,61,0.35)] ${className}`}>
      <video controls preload="none" playsInline poster={video.poster} className="aspect-video w-full bg-[#0B0F19]">
        <source src={video.src} type="video/mp4" />
        Your browser can&apos;t play this video. <a href={video.src}>Download the video</a>.
      </video>
    </div>
  );
}
