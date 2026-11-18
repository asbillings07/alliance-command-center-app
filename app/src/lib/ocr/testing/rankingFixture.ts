import type { Recognition, OcrWord } from "../recognition";

// Invented people/data only. The selected tab is expressed in pixels, not text.
export function rankingFixture(kind: "monday" | "tuesday" | "weekly" | "missing" = "monday") {
  const words: OcrWord[] = [
    { text: "RANKING", x: 20, y: 30, width: 150, height: 30 },
    { text: "Daily", x: 45, y: 100, width: 65, height: 24 }, { text: "Rank", x: 115, y: 100, width: 60, height: 24 },
    { text: "Weekly", x: 270, y: 100, width: 90, height: 24 }, { text: "Rank", x: 370, y: 100, width: 60, height: 24 },
    ...["Mon.", "Tues.", "Wed.", "Thur.", "Fri.", "Sat."].map((text, i) => ({ text, x: 45 + i * 87, y: 175, width: 48, height: 18 })),
    { text: "Ranking", x: 25, y: 245, width: 75, height: 20 }, { text: "Commander", x: 180, y: 245, width: 130, height: 20 },
    { text: "Points", x: 470, y: 245, width: 80, height: 20 },
    ...["Jordan Vale", "Morgan Reed", "Riley Chen"].flatMap((text, i) => [
      { text, x: 180, y: 320 + i * 100, width: 150, height: 22 },
      { text: "[QA] Synthetic", x: 180, y: 355 + i * 100, width: 150, height: 20 },
      { text: ["23,340,000", "19,317,601", "17,512,500"][i], x: 430, y: 337 + i * 100, width: 140, height: 22 },
    ]),
  ];
  const recognition: Recognition = { text: words.map(w => w.text).join("\n"), words };
  const active = kind === "weekly" ? 255 : 30;
  const day = kind === "tuesday" ? 122 : 35;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#c8cedc"/>
    ${kind === "missing" ? "" : `<rect x="${active}" y="75" width="190" height="75" fill="#ff9500"/>`}
    ${kind === "weekly" || kind === "missing" ? "" : `<rect x="${day}" y="155" width="80" height="58" fill="#fffafa"/>`}
    ${words.map(w => `<text x="${w.x}" y="${w.y + w.height}" font-family="sans-serif" font-size="${w.height}" fill="#171d33">${w.text}</text>`).join("")}</svg>`;
  return { recognition, svg };
}
