import { createInterface } from 'node:readline';
import type { Terminal } from './env.js';

/** The real terminal: prompts on stderr, so stdout carries only command output. */
export function processTerminal(): Terminal {
  return {
    isTTY: process.stdin.isTTY === true,
    ask: (question, { hidden }) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        rl.question(question, (answer) => {
          rl.close();
          if (hidden) process.stderr.write('\n');
          resolve(answer);
        });
        if (hidden) {
          // Stop echoing what is typed; the prompt itself was already written.
          (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};
        }
      }),
  };
}

export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}
