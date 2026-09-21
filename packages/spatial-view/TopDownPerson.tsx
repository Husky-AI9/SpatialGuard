export type ActivityKind = "delivery" | "person" | "face_covering" | "weapon" | "intrusion"
  | "package" | "animal" | "vehicle" | "unknown" | "none" | "possible_threat";

export const activityColor = (kind: ActivityKind) => ({
  delivery: "#2563a9", person: "#c23b47", face_covering: "#546779",
  weapon: "#222222", intrusion: "#222222", possible_threat: "#222222",
  package: "#95622c", animal: "#746044", vehicle: "#386987",
  unknown: "#666970", none: "#55715e",
}[kind]);

/** Presentation-only SVG artwork. Activity interpretation belongs to the consumer. */
export default function TopDownPerson({ kind = "person" }: {
  kind?: ActivityKind;
}) {
  const delivery = kind === "delivery";
  const color = delivery ? "#edbd39" : activityColor(kind);
  const person = ["delivery", "person", "face_covering", "weapon", "intrusion", "possible_threat"].includes(kind);
  return (
    <g className={`map-actor-symbol activity-symbol-${kind}`} stroke="#34383a" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
      {person && <>
      <path d="M17 45L13 56Q32 65 51 56L47 45Z" fill={color} />
      <ellipse cx="32" cy="40" rx="24" ry="15" fill={color} />
      {delivery && <g className="map-actor-package">
        <rect x="11" y="3" width="42" height="25" rx="2" fill="#d49b62" />
        <path d="M28 4H36V14H28Z" fill="#f4d7af" strokeWidth="2" />
        <path d="M43 20H48M40 24H48" fill="none" strokeWidth="2" />
        <path d="M10 18Q4 17 4 23V31Q5 36 11 33L15 27V22Q15 18 10 18Z" fill="#f4d7af" />
        <path d="M54 18Q60 17 60 23V31Q59 36 53 33L49 27V22Q49 18 54 18Z" fill="#f4d7af" />
      </g>}
      <circle cx="32" cy="39" r="13" fill={delivery ? "#f6ca48" : color} />
      {delivery && <path d="M19 35Q32 27 45 35L44 30Q32 19 20 30Z" fill="#e9b72e" />}
      {delivery && <path d="M32 28V47" stroke="#b88720" strokeWidth="1.5" />}
      {kind === "person" && <path d="M22 33Q32 26 42 33" stroke="#f3b9bd" strokeWidth="2" fill="none" />}
      {kind === "face_covering" && <g className="activity-mask">
        <path d="M18 28Q32 18 46 28L44 35Q32 41 20 35Z" fill="#dce8ee" />
        <path d="M24 29H40M26 33H38" stroke="#718797" strokeWidth="1.5" />
      </g>}
      {kind === "intrusion" && <g className="activity-entry">
        <path d="M5 24V3H28V21" fill="none" />
        <path d="M10 24V7L23 12V30Z" fill="#e0a24a" />
        <path d="M30 12H45M40 7L45 12L40 17" fill="none" stroke="#a96910" />
      </g>}
      {["possible_threat", "weapon", "intrusion"].includes(kind) && <g className="activity-warning">
        <path d="M51 2L63 24H39Z" fill="#f2c94c" strokeWidth="2" />
        <path d="M51 9V15M51 19V20" strokeWidth="2.5" />
      </g>}
      </>}
      {kind === "package" && <g>
        <rect x="8" y="9" width="48" height="46" rx="3" fill="#d49b62" />
        <path d="M27 10H37V54H27Z" fill="#f4d7af" strokeWidth="2" />
        <path d="M9 31H55M43 44H50M43 49H50" fill="none" strokeWidth="2" />
      </g>}
      {kind === "animal" && <g>
        <path d="M32 50Q50 64 55 48" fill="none" stroke="#866747" strokeWidth="6" />
        <path d="M20 27L13 31M44 27L51 31M21 46L16 52M43 46L48 52" stroke="#866747" strokeWidth="7" />
        <ellipse cx="32" cy="35" rx="14" ry="21" fill="#c8a77c" />
        <path d="M19 13L12 4L13 25L22 24M45 13L52 4L51 25L42 24" fill="#866747" />
        <ellipse cx="32" cy="17" rx="14" ry="13" fill="#c8a77c" />
        <ellipse cx="32" cy="6" rx="5" ry="3" fill="#34383a" strokeWidth="1" />
      </g>}
      {kind === "vehicle" && <g>
        <path d="M13 15V23M51 15V23M13 43V51M51 43V51" strokeWidth="5" />
        <rect x="16" y="3" width="32" height="58" rx="9" fill="#74a6c4" />
        <path d="M21 15L19 25H45L43 15Z" fill="#dcecf2" />
        <path d="M21 49L19 40H45L43 49Z" fill="#dcecf2" />
        <path d="M17 29H12M47 29H52M24 7H40" fill="none" strokeWidth="2" />
      </g>}
      {kind === "unknown" && <g>
        <path d="M32 4L60 32L32 60L4 32Z" fill="#e0e2e4" />
        <path d="M24 23C24 12 44 13 43 25C43 32 32 30 32 39M32 46V47" fill="none" strokeWidth="5" />
      </g>}
      {kind === "none" && <g>
        <circle cx="32" cy="32" r="25" fill="#e1e9e3" stroke="#55715e" />
        <path d="M19 32H45" stroke="#55715e" strokeWidth="5" />
      </g>}
    </g>
  );
}
