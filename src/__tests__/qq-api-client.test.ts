import { describe, it, expect } from "vitest"
import { parseQQMediaMessage, sanitizeFilename } from "../channel/qq/qq-api-client.js"

describe("parseQQMediaMessage", () => {
    it("should parse image message", () => {
        const message = [
            { type: "image", data: { file: "abc123", name: "test.png" } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("image")
        expect(result[0].fileId).toBe("abc123")
        expect(result[0].fileName).toBe("test.png")
    })

    it("should parse file message", () => {
        const message = [
            { type: "file", data: { file: "def456", name: "document.pdf", size: 1024 } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("file")
        expect(result[0].fileName).toBe("document.pdf")
        expect(result[0].fileSize).toBe(1024)
    })

    it("should parse video message", () => {
        const message = [
            { type: "video", data: { file: "vid789", name: "video.mp4", url: "https://example.com/video.mp4" } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("video")
        expect(result[0].url).toBe("https://example.com/video.mp4")
    })

    it("should parse record message", () => {
        const message = [
            { type: "record", data: { file: "rec001", name: "voice.silk" } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("record")
    })

    it("should parse multiple media items", () => {
        const message = [
            { type: "image", data: { file: "img1" } },
            { type: "file", data: { file: "file1", name: "doc.txt" } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(2)
        expect(result[0].type).toBe("image")
        expect(result[1].type).toBe("file")
    })

    it("should skip unknown types", () => {
        const message = [
            { type: "text", data: { content: "hello" } },
            { type: "at", data: { user_id: "123" } },
            { type: "image", data: { file: "img1" } },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("image")
    })

    it("should handle empty message array", () => {
        const result = parseQQMediaMessage([])
        expect(result).toHaveLength(0)
    })

    it("should handle non-array input", () => {
        const result = parseQQMediaMessage(null as any)
        expect(result).toHaveLength(0)
    })

    it("should handle message items with missing data field", () => {
        const message = [
            { type: "image" },
            { type: "file", data: null },
        ]
        const result = parseQQMediaMessage(message)
        expect(result).toHaveLength(2)
    })

    it("should use file field or id as fileId", () => {
        const message1 = [{ type: "image", data: { file: "has-file-field" } }]
        const message2 = [{ type: "image", data: { id: "has-id-field" } }]
        const message3 = [{ type: "image", data: {} }]

        expect(parseQQMediaMessage(message1)[0].fileId).toBe("has-file-field")
        expect(parseQQMediaMessage(message2)[0].fileId).toBe("has-id-field")
        expect(parseQQMediaMessage(message3)[0].fileId).toBe("")
    })
})

describe("sanitizeFilename", () => {
    it("should remove path separators", () => {
        const result = sanitizeFilename("../../../etc/passwd")
        expect(result).not.toContain("..")
        expect(result).not.toContain("/")
        expect(result).not.toContain("\\")
    })

    it("should remove control characters", () => {
        const result = sanitizeFilename("file\x00name.txt")
        expect(result).not.toContain("\x00")
    })

    it("should add timestamp prefix", () => {
        const result = sanitizeFilename("test.png")
        expect(result).toMatch(/^\d+-[a-f0-9]+-test\.png$/)
    })

    it("should use default name for empty input", () => {
        const result = sanitizeFilename("")
        expect(result).toMatch(/^\d+-[a-f0-9]+-file$/)
    })

    it("should preserve extension", () => {
        const result = sanitizeFilename("document.pdf")
        expect(result.endsWith(".pdf")).toBe(true)
    })

    it("should clamp long filenames", () => {
        const longName = "a".repeat(250) + ".txt"
        const result = sanitizeFilename(longName)
        expect(result.length).toBeLessThan(220)
    })
})
