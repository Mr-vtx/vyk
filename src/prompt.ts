import { createInterface } from "node:readline/promises";

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(
      `${question} (y/N) — not an interactive terminal, defaulting to No.`,
    );
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} (y/N) `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}
