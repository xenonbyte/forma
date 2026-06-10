type Platform = "mobile" | "tablet" | "desktop" | "web";

function normalize(platform: string | undefined): Platform {
  return platform === "mobile" || platform === "tablet" || platform === "desktop" ? platform : "web";
}

const PATHS: Record<Platform, string> = {
  mobile:
    "M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Zm2.5 14.5h3",
  tablet:
    "M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Zm4.5 14h2",
  desktop: "M4.5 5.5h15v9h-15zM9 19h6M12 14.5V19",
  web: "M4.5 5.5h15v13h-15zM4.5 9h15",
};

/** Platform glyph for a tile header. Unknown/absent → web. */
export function PlatformIcon({
  platform,
  size = 14,
}: {
  platform: string | undefined;
  size?: number;
}): React.ReactElement {
  const p = normalize(platform);
  return (
    <svg aria-hidden="true" data-platform={p} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d={PATHS[p]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
