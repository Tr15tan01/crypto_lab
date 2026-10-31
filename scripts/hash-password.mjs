#!/usr/bin/env node
/**
 * Generates a bcrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-password
 *
 * The password is read from a hidden prompt (works in PowerShell, cmd and bash) and is never
 * written to disk. The script prints:
 *   - the raw hash, for the Vercel dashboard, and
 *   - an escaped line for .env.local (Next.js expands `$` in .env files, so each `$` is escaped).
 */
import bcrypt from "bcryptjs";
import readline from "node:readline";

const COST = 12;

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) {
      if (rl.stdoutMuted && !s.includes(question)) rl.output.write("");
      else rl.output.write(s);
    };
    rl.stdoutMuted = true;
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  let password = process.env.ADMIN_PASSWORD_PLAINTEXT;
  if (password) {
    console.warn("Using ADMIN_PASSWORD_PLAINTEXT from the environment. Remove it afterwards.");
  } else {
    password = await promptHidden("New administrator password: ");
    const confirm = await promptHidden("Repeat password: ");
    if (password !== confirm) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }
  if (!password || password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);
  const escaped = hash.replace(/\$/g, "\\$");

  console.log("\nFor the Vercel dashboard (Environment Variables), paste the raw value:");
  console.log(`  ${hash}`);
  console.log("\nFor .env.local, use this exact line (dollar signs escaped):");
  console.log(`  ADMIN_PASSWORD_HASH=${escaped}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
