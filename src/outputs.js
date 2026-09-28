import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Formats step outputs for $GITHUB_OUTPUT. Every value uses the heredoc form with a random
// delimiter, because some values (the prompt, which carries the diff) are PR-controlled text, and
// a fixed delimiter appearing in a diff would let the PR author set other outputs.
export function formatOutputs(outputs) {
  let text = '';
  for (const [name, raw] of Object.entries(outputs)) {
    const value = String(raw);
    let delimiter;
    do delimiter = `FLYTRAP_${randomBytes(16).toString('hex')}`;
    while (value.includes(delimiter));
    text += `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  }
  return text;
}

export function writeOutputs(outputs, file = process.env.GITHUB_OUTPUT) {
  const text = formatOutputs(outputs);
  if (file) appendFileSync(file, text);
  else process.stdout.write(text);
}
