import { describe, expect, it } from "vitest";
import { detectIntent } from "@/services/ai/context/detect";
import { extractAssessment, extractFollowUps } from "@/services/ai/orchestration/follow-ups";
import { normalizeTurns } from "@/services/ai/orchestration/chat-service";

const KNOWN = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ONE", "THE", "USDC", "PEPE"]);

describe("detectIntent", () => {
  it("finds tickers, names and full pairs", () => {
    expect(detectIntent("Compare SOL and ETH", KNOWN).baseAssets).toEqual(["SOL", "ETH"]);
    expect(detectIntent("Will bitcoin rise this month?", KNOWN).baseAssets).toEqual(["BTC"]);
    expect(detectIntent("what about btc and dogecoin", KNOWN).baseAssets).toEqual(["BTC", "DOGE"]);
    expect(detectIntent("Is DOGEUSDT liquid?", KNOWN).baseAssets).toContain("DOGE");
  });

  it("ignores common words that happen to be tickers and stablecoins", () => {
    const i = detectIntent("Is THE ONE thing I should watch USDC?", KNOWN);
    expect(i.baseAssets).toEqual([]);
    expect(i.marketWide).toBe(true);
  });

  it("puts the focus symbol first", () => {
    expect(detectIntent("is volume unusually high?", KNOWN, "PEPE").baseAssets).toEqual(["PEPE"]);
  });

  it("only includes portfolio data when the question needs it", () => {
    expect(detectIntent("What is happening with Ethereum?", KNOWN).portfolio).toBe(false);
    expect(detectIntent("Analyze my current holdings", KNOWN).portfolio).toBe(true);
    expect(detectIntent("Should I buy SOL?", KNOWN).portfolio).toBe(true);
    expect(detectIntent("Review my previous purchases", KNOWN).history).toBe(true);
    expect(detectIntent("Was my original investment thesis correct?", KNOWN).journal).toBe(true);
  });

  it("parses what-if scenarios", () => {
    const i = detectIntent("What would happen to my portfolio if Bitcoin dropped 20%?", KNOWN);
    expect(i.scenarios).toEqual([{ asset: "BTC", changePercent: -20 }]);
    expect(i.portfolio).toBe(true);
    expect(detectIntent("and if ETH rises by 12.5%", KNOWN).scenarios).toEqual([{ asset: "ETH", changePercent: 12.5 }]);
  });
});

describe("extractFollowUps", () => {
  it("splits the follow-up line from the content", () => {
    const r = extractFollowUps("Answer body.\n\nFOLLOW_UPS: What about volume? || How does ETH compare? || **Risks?**");
    expect(r.content).toBe("Answer body.");
    expect(r.followUps).toEqual(["What about volume?", "How does ETH compare?", "Risks?"]);
  });

  it("returns the text unchanged when there is no follow-up line", () => {
    expect(extractFollowUps(" text ")).toEqual({ content: "text", followUps: [] });
  });
});

describe("extractAssessment", () => {
  it("parses a valid assessment line", () => {
    const r = extractAssessment('## 13. Final\nok\nASSESSMENT_JSON: {"bias":"bearish","bullishRange":[110,100],"bearishRange":null}');
    expect(r.content).toBe("## 13. Final\nok");
    expect(r.assessment).toEqual({ bias: "bearish", bullishRange: [100, 110], bearishRange: null });
  });

  it("treats malformed output as not evaluable rather than guessing", () => {
    expect(extractAssessment("report\nASSESSMENT_JSON: {bias: up").assessment.bias).toBeNull();
    expect(extractAssessment('report\nASSESSMENT_JSON: {"bias":"moon"}').assessment.bias).toBeNull();
    expect(extractAssessment("report without line").assessment.bias).toBeNull();
  });
});

describe("normalizeTurns", () => {
  it("starts with a user turn and merges consecutive roles", () => {
    expect(
      normalizeTurns([
        { role: "assistant", content: "orphan" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });
});
