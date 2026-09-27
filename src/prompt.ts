import { createInterface } from 'node:readline/promises';

/**
 * Prompts the user with `question (y/N)` and waits for real input.
 * Anything other than an exact "y"/"Y" — including a bare Enter — counts
 * as No. If stdin isn't an interactive terminal at all (piped input, no
 * TTY), there's no safe way to ask, so this returns false without
 * prompting rather than hanging or guessing.
 */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`${question} (y/N) — not an interactive terminal, defaulting to No.`);
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} (y/N) `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}
