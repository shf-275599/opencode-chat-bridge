# Implementation Plan: Feishu File/Document Sending

## Overview

Add file/document sending functionality to the Feishu channel in opencode-im-bridge. Currently only images are supported via `sendImage`. This plan adds `sendFile` support for documents (PDF, DOC, XLS, etc.) following the same security model and architecture patterns.

---

## Current State Analysis

### Existing Infrastructure (Already Implemented)
- `FeishuApiClient.uploadFile()` - Uploads files to Feishu /im/v1/files API (line 300-318)
- `ChannelOutboundAdapter.sendImage()` - Interface method for image sending
- `FeishuPlugin.outbound.sendImage()` - Feishu-specific image implementation
- `outbound-media.ts` - Detects file paths and sends images
- Security model: allowlist check, symlink resolution, 20MB limit

### Gap
- No `sendFile` method in `ChannelOutboundAdapter` interface
- `FeishuPlugin.outbound` lacks `sendFile` implementation
- `outbound-media.ts` filters to images only, skips other files

---

## Requirements

### Functional Requirements
- **REQ-001**: Add `sendFile?` optional method to `ChannelOutboundAdapter` interface
- **REQ-002**: Implement `sendFile` in `FeishuPlugin.outbound` adapter
- **REQ-003**: Route non-image files (PDF, DOC, XLS, TXT, MD, ZIP, etc.) to `sendFile`
- **REQ-004**: Maintain same security model as images (allowlist, symlinks, size limit)

### Non-Functional Requirements
- **REQ-005**: File size limit: 20MB (reuse `MAX_UPLOAD_BYTES`)
- **REQ-006**: Support file types: pdf, doc, docx, xls, xlsx, txt, md, zip, tar, gz, csv, json, yaml, html, css, js, ts, py
- **REQ-007**: Use existing `uploadFile` API in `FeishuApiClient`
- **REQ-008**: Follow existing code patterns and TypeScript conventions

### Security Requirements
- **SEC-001**: Same allowlist directories as images
- **SEC-002**: Resolve symlinks via `fs.realpath` before allowlist check
- **SEC-003**: Pre-filter paths via string prefix check before FS calls
- **SEC-004**: 20MB hard limit per file

---

## TDD Test Strategy

### Test Files to Create/Modify

#### 1. `src/channel/types.test.ts` (NEW)
**Purpose**: Verify `ChannelOutboundAdapter` interface accepts `sendFile` method

**Test Cases**:
```typescript
// Test: Interface accepts sendFile method
describe("ChannelOutboundAdapter", () => {
  it("should accept sendFile as optional method", () => {
    const adapter: ChannelOutboundAdapter = {
      sendText: async () => {},
      sendFile: async () => {}, // Should compile
    }
    expect(adapter.sendFile).toBeDefined()
  })
})
```

#### 2. `src/feishu/api-client.test.ts` (EXTEND)
**Purpose**: Verify `uploadFile` works correctly (already implemented, add tests)

**Test Cases**:
```typescript
describe("uploadFile", () => {
  it("should upload file and return file_key", async () => {
    // Mock Feishu API response
    // Verify FormData contains file_type, file_name, file
    // Assert returned file_key matches mock
  })

  it("should throw on API error", async () => {
    // Mock error response (code !== 0)
    // Assert throws with error message
  })
})
```

#### 3. `src/channel/feishu/feishu-plugin.test.ts` (NEW or EXTEND)
**Purpose**: Verify `FeishuPlugin.outbound.sendFile` implementation

**Test Cases**:
```typescript
describe("FeishuPlugin.outbound.sendFile", () => {
  it("should read file and upload via apiClient", async () => {
    // Mock fs.readFile -> Buffer
    // Mock feishuClient.uploadFile -> "file_key_123"
    // Mock feishuClient.sendMessage
    // Assert sendMessage called with correct file message format
  })

  it("should use file name in upload", async () => {
    // Verify fileName passed to uploadFile matches basename(filePath)
  })

  it("should send file message with correct format", async () => {
    // Assert msg_type === "file"
    // Assert content contains file_key
  })
})
```

#### 4. `src/handler/outbound-media.test.ts` (EXTEND)
**Purpose**: Verify non-image files are routed to `sendFile`

**Test Cases**:
```typescript
describe("sendDetectedFiles - file support", () => {
  it("should detect and send PDF files via sendFile", async () => {
    // Input text with PDF path
    // Mock adapter with sendFile
    // Assert sendFile called with correct target and path
  })

  it("should detect and send DOCX files via sendFile", async () => {
    // Input text with .docx path
    // Assert sendFile called
  })

  it("should send both images and files in same message", async () => {
    // Input with .png and .pdf paths
    // Assert sendImage called for PNG
    // Assert sendFile called for PDF
  })

  it("should skip files outside allowlist", async () => {
    // Input with file path outside allowed directories
    // Assert sendFile NOT called
    // Assert warning logged
  })

  it("should skip files exceeding size limit", async () => {
    // Mock fs.stat with size > 20MB
    // Assert sendFile NOT called
    // Assert warning logged
  })

  it("should resolve symlinks before sending", async () => {
    // Mock fs.realpath returning different path
    // Assert sendFile called with resolved path
  })
})
```

---

## Implementation Plan

### Phase 1: Interface Extension (Atomic Commit 1)

#### File: `src/channel/types.ts`
**Change**: Add `sendFile?` method to `ChannelOutboundAdapter`

**Code Change**:
```typescript
export interface ChannelOutboundAdapter {
  /**
   * Send text message to a target
   * @param target Destination specification
   * @param text Message text to send
   */
  sendText(target: OutboundTarget, text: string): Promise<void>;

  /**
   * Optional: Send rich card/formatted message
   * @param target Destination specification
   * @param card Card object (channel-specific format)
   */
  sendCard?(target: OutboundTarget, card: unknown): Promise<void>;

  /**
   * Optional: Send image file to a target
   * @param target Destination specification
   * @param filePath Absolute path to the image file (already validated and within allowlist)
   */
  sendImage?(target: OutboundTarget, filePath: string): Promise<void>;

  /**
   * Optional: Send document/file to a target
   * @param target Destination specification
   * @param filePath Absolute path to the file (already validated and within allowlist)
   */
  sendFile?(target: OutboundTarget, filePath: string): Promise<void>;
}
```

**Test**: Run TypeScript compiler to verify no type errors
```bash
bun run build
```

---

### Phase 2: Feishu Plugin Implementation (Atomic Commit 2)

#### File: `src/channel/feishu/feishu-plugin.ts`
**Change**: Add `sendFile` method to `outbound` adapter

**Code Change** (in constructor, after sendImage):
```typescript
// 4. Outbound adapter
this.outbound = {
  sendText: async (target: OutboundTarget, text: string): Promise<void> => {
    await this.feishuClient.sendMessage(target.address, {
      msg_type: "interactive",
      content: JSON.stringify(buildResponseCard(text)),
    })
  },

  sendCard: async (target: OutboundTarget, card: unknown): Promise<void> => {
    await this.feishuClient.sendMessage(target.address, {
      msg_type: "interactive",
      content: JSON.stringify(card),
    })
  },

  sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
    this.logger.info(`[FeishuPlugin] Sending image: ${filePath} to ${target.address}`)
    const fileData = await readFile(filePath)
    const imageKey = await this.feishuClient.uploadImage(fileData)
    await this.feishuClient.sendMessage(target.address, {
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    })
    this.logger.info(`[FeishuPlugin] Image sent: ${imageKey}`)
  },

  sendFile: async (target: OutboundTarget, filePath: string): Promise<void> => {
    this.logger.info(`[FeishuPlugin] Sending file: ${filePath} to ${target.address}`)
    const fileData = await readFile(filePath)
    const fileName = basename(filePath)
    const fileKey = await this.feishuClient.uploadFile(fileData, fileName)
    await this.feishuClient.sendMessage(target.address, {
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    })
    this.logger.info(`[FeishuPlugin] File sent: ${fileKey}`)
  },
}
```

**Import to add**:
```typescript
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
```

**Test**: Build and run unit tests
```bash
bun run build
bun run test:run
```

---

### Phase 3: Outbound Media Handler Update (Atomic Commit 3)

#### File: `src/handler/outbound-media.ts`
**Changes**:
1. Add file extension detection constant
2. Update `sendDetectedFiles` to handle both images and files
3. Add helper to determine if path is image vs file

**Code Changes**:

**Step 1**: Add file extension regex (after IMAGE_EXTENSIONS):
```typescript
// Image extensions (case-insensitive)
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp)$/i

// Document/file extensions (case-insensitive) - excludes SVG (treated as regular file)
const FILE_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|csv|zip|tar|gz|mp3|mp4|wav|mov|avi|txt|md|json|yaml|yml|html|css|js|ts|py|svg)$/i
```

**Step 2**: Update `sendDetectedFiles` method signature comment and logic:

```typescript
return {
  async sendDetectedFiles(target: OutboundTarget, text: string, outboundAdapter?: ChannelOutboundAdapter): Promise<void> {
    const adapter = outboundAdapter ?? outbound
    // Skip entirely if no outbound adapter
    if (!adapter) {
      logger.debug("Channel plugin not provided, skipping media detection")
      return
    }

    const paths = [...new Set(extractFilePaths(text))]
    if (paths.length === 0) {
      logger.debug(`No file paths detected in response text (${text.length} chars)`)
      return
    }

    logger.info(`Detected ${paths.length} file path(s) in agent reply, processing...`)

    // Separate images and files
    const imagePaths: string[] = []
    const filePaths: string[] = []

    for (const filePath of paths) {
      if (isImageFile(filePath)) {
        imagePaths.push(filePath)
      } else if (isDocumentFile(filePath)) {
        filePaths.push(filePath)
      }
    }

    // Process images if adapter supports sendImage
    if (imagePaths.length > 0 && adapter.sendImage) {
      logger.info(`Processing ${imagePaths.length} image(s)...`)
      for (const filePath of imagePaths) {
        await processFile(filePath, target, adapter, "image", logger, allowlist)
      }
    }

    // Process files if adapter supports sendFile
    if (filePaths.length > 0 && adapter.sendFile) {
      logger.info(`Processing ${filePaths.length} file(s)...`)
      for (const filePath of filePaths) {
        await processFile(filePath, target, adapter, "file", logger, allowlist)
      }
    }
  },
}
```

**Step 3**: Add helper function `isDocumentFile`:

```typescript
function isDocumentFile(filePath: string): boolean {
  return FILE_EXTENSIONS.test(filePath)
}
```

**Step 4**: Add shared processing function:

```typescript
async function processFile(
  filePath: string,
  target: OutboundTarget,
  adapter: ChannelOutboundAdapter,
  type: "image" | "file",
  logger: Logger,
  allowlist: string[],
): Promise<void> {
  try {
    // Cheap string prefilter — skip FS calls for paths clearly outside allowlist
    const resolved = normalizePath(resolve(filePath))
    if (!allowlist.some((dir) => resolved === dir || resolved.startsWith(dir + "/"))) {
      logger.debug(`Skipped ${filePath}: outside allowed directories (prefilter)`)
      return
    }

    // Security: resolve symlinks and verify path is within allowlist
    const realPath = await resolveAllowedPath(filePath, allowlist, logger)
    if (!realPath) return

    // Check file size using resolved path
    const fileStat = await stat(realPath)
    if (fileStat.size > MAX_UPLOAD_BYTES) {
      logger.warn(`Skipping ${realPath}: exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB size limit`)
      return
    }

    // Delegate to channel plugin — it owns the upload/send implementation
    if (type === "image" && adapter.sendImage) {
      await adapter.sendImage(target, realPath)
      logger.info(`Sent image via channel plugin: ${realPath}`)
    } else if (type === "file" && adapter.sendFile) {
      await adapter.sendFile(target, realPath)
      logger.info(`Sent file via channel plugin: ${realPath}`)
    }
  } catch (err) {
    logger.warn(`Failed to send ${type} ${filePath}: ${err}`)
  }
}
```

**Step 5**: Update `EXT_REGEX` to include all supported extensions:

```typescript
const EXT_REGEX = /\.(png|jpg|jpeg|gif|webp|pdf|svg|doc|docx|xls|xlsx|csv|zip|tar|gz|mp3|mp4|wav|mov|avi|txt|md|json|yaml|yml|html|css|js|ts|py)$/i
```

**Test**: Build and run tests
```bash
bun run build
bun run test:run
```

---

## File Change Summary

| File | Change Type | Lines Added | Lines Modified |
|------|-------------|-------------|----------------|
| `src/channel/types.ts` | Add method to interface | +8 | 0 |
| `src/channel/feishu/feishu-plugin.ts` | Add sendFile implementation | +12 | 0 |
| `src/handler/outbound-media.ts` | Refactor to support files | +60 | -30 |
| `src/handler/outbound-media.test.ts` | Add tests (existing) | +80 | 0 |

---

## Atomic Commit Strategy

### Commit 1: `feat(types): add sendFile method to ChannelOutboundAdapter`
```
- Add sendFile? optional method to ChannelOutboundAdapter interface
- Add JSDoc documentation
- No functional changes
```

### Commit 2: `feat(feishu): implement sendFile in FeishuPlugin outbound adapter`
```
- Implement sendFile method in FeishuPlugin.outbound
- Uses existing FeishuApiClient.uploadFile
- Sends file message with correct msg_type and content format
- Logs file operations for debugging
```

### Commit 3: `feat(handler): route non-image files to sendFile in outbound-media`
```
- Add FILE_EXTENSIONS constant for document types
- Add isDocumentFile helper function
- Refactor sendDetectedFiles to process both images and files
- Extract shared file processing logic into processFile function
- Update EXT_REGEX to include all supported file types
```

### Commit 4: `test(outbound-media): add tests for file sending functionality`
```
- Add tests for PDF, DOCX file detection
- Add tests for mixed image+file messages
- Add tests for security (allowlist, size limits, symlinks)
```

---

## Verification Steps

### Build Verification
```bash
bun run build
```
Expected: No TypeScript errors

### Unit Test Verification
```bash
bun run test:run
```
Expected: All tests pass

### Integration Test (Manual)
1. Start opencode server
2. Start opencode-im-bridge
3. Send message to Feishu bot that generates a file (e.g., "create a report.pdf")
4. Verify file is uploaded and sent to Feishu chat
5. Verify file appears in chat with correct name

### Security Test Cases
1. **Allowlist**: Try to send file from outside allowed directories → Should be blocked
2. **Symlink**: Create symlink pointing outside allowlist → Should be blocked
3. **Size limit**: Try to send 25MB file → Should be blocked with warning
4. **Extension**: Try to send .exe file → Should not be detected as valid file

---

## Edge Cases & Error Handling

### File Not Found
- Log warning: "File not found: {path}"
- Continue processing other files

### Upload Failure
- Log error: "Failed to upload file: {error}"
- Continue processing other files

### Send Failure
- Log error: "Failed to send file message: {error}"
- Continue processing other files

### Empty File
- Zero-byte files are allowed by Feishu API
- Will be sent as-is

### Special Characters in Filename
- Feishu API handles encoding
- basename() extracts filename correctly on all platforms

---

## Dependencies

### No New Dependencies Required
All functionality uses existing:
- `node:fs/promises` (readFile)
- `node:path` (basename)
- Existing `FeishuApiClient.uploadFile`
- Existing security utilities

---

## Rollback Plan

If issues occur:

1. **Revert Commit 3** (outbound-media.ts) → Files will be skipped (old behavior)
2. **Revert Commit 2** (feishu-plugin.ts) → sendFile method removed
3. **Revert Commit 1** (types.ts) → Interface reverted

Each commit is independent and safe to revert individually.

---

## Post-Implementation Notes

### Future Enhancements (Out of Scope)
- Batch file uploads for multiple files
- Progress indicators for large file uploads
- Support for additional file types
- Compression for large text files before upload
- Configurable file size limits per channel

### Performance Considerations
- Files are read entirely into memory before upload
- For very large files (near 20MB), consider streaming upload
- Current implementation matches existing image upload pattern

---

## Appendix: Feishu API Reference

### Upload File Endpoint
```
POST https://open.feishu.cn/open-apis/im/v1/files
Content-Type: multipart/form-data
Authorization: Bearer {token}

Form fields:
- file_type: "stream" (default)
- file_name: "document.pdf"
- file: <binary data>
```

### Send File Message
```
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id
Authorization: Bearer {token}

Body:
{
  "receive_id": "{chat_id}",
  "msg_type": "file",
  "content": "{\"file_key\": \"{file_key}\"}"
}
```
