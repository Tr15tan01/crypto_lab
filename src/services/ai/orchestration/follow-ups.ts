/** Splits the trailing "FOLLOW_UPS: a || b || c" line from an assistant reply. */
export function extractFollowUps(text: string): { content: string; followUps: string[] } {
  const idx = text.lastIndexOf("FOLLOW_UPS:");
  if (idx === -1) return { content: text.trim(), followUps: [] };
  const content = text.slice(0, idx).trim();
  const followUps = text
    .slice(idx + "FOLLOW_UPS:".length)
    .split("||")
    .map((s) => s.replace(/[*_`]/g, "").trim())
    .filter((s) => s.length > 3 && s.length < 200)
    .slice(0, 3);
  return { content, followUps };
}

export interface ResearchAssessment {
  bias: "bullish" | "neutral" | "bearish" | null;
  bullishRange: [number, number] | null;
  bearishRange: [number, number] | null;
}

function range(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v.map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a! <= 0 || b! <= 0) return null;
  return a! <= b! ? [a!, b!] : [b!, a!];
}

/** Parses the trailing ASSESSMENT_JSON line; anything malformed becomes "not evaluable" (null). */
export function extractAssessment(text: string): { content: string; assessment: ResearchAssessment } {
  const idx = text.lastIndexOf("ASSESSMENT_JSON:");
  const empty: ResearchAssessment = { bias: null, bullishRange: null, bearishRange: null };
  if (idx === -1) return { content: text.trim(), assessment: empty };
  const content = text.slice(0, idx).replace(/```\s*$/, "").trim();
  const raw = text.slice(idx + "ASSESSMENT_JSON:".length).replace(/```/g, "").trim();
  try {
    const json = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const bias = json.bias === "bullish" || json.bias === "neutral" || json.bias === "bearish" ? json.bias : null;
    return { content, assessment: { bias, bullishRange: range(json.bullishRange), bearishRange: range(json.bearishRange) } };
  } catch {
    return { content, assessment: empty };
  }
}
