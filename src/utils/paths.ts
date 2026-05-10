import { resolve } from "node:path"

export function getAttachmentsDir(): string {
  const cwdBase = process.env["OPENCODE_CWD"] ?? process.cwd()
  return resolve(cwdBase, ".opencode-lark", "attachments")
}