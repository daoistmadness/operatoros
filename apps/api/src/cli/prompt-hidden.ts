export async function promptHiddenValues(prompts: string[]): Promise<string[]> {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    const values = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    return prompts.map((prompt, index) => {
      process.stdout.write(prompt);
      return values[index] ?? "";
    });
  }

  const values: string[] = [];
  try {
    for (const prompt of prompts) {
      process.stdout.write(prompt);
      stdin.setRawMode?.(true);
      values.push(await new Promise((resolve) => {
        let value = "";
        const onData = (char: Buffer) => {
          const input = char.toString("utf8");
          if (input === "\n" || input === "\r" || input === "\u0004") {
            stdin.removeListener("data", onData);
            stdin.setRawMode?.(false);
            process.stdout.write("\n");
            resolve(value);
          } else if (input === "\u0003") {
            process.stdout.write("\n");
            process.exit(130);
          } else if (input === "\x7f" || input === "\b") {
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write("\b \b");
            }
          } else {
            value += input;
            process.stdout.write("*");
          }
        };
        stdin.on("data", onData);
      }));
    }
    return values;
  } finally {
    stdin.setRawMode?.(false);
  }
}

export async function promptHidden(prompt: string): Promise<string> {
  return (await promptHiddenValues([prompt]))[0] ?? "";
}
