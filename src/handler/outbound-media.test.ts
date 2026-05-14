import { extractFilePaths } from "../handler/outbound-media.js"
import { describe, it, expect } from "vitest"

describe("extractFilePaths Windows paths", () => {
  it("matches Windows backslash paths", () => {
    const paths = extractFilePaths("C:\\Users\\Yoi\\Downloads\\memflow-icon.png")
    expect(paths).toContain("C:/Users/Yoi/Downloads/memflow-icon.png")
  })

  it("matches Windows forward slash paths", () => {
    const paths = extractFilePaths("C:/Users/Yoi/Downloads/memflow-icon.png")
    expect(paths).toContain("C:/Users/Yoi/Downloads/memflow-icon.png")
  })

  it("normalizes backslashes to forward slashes", () => {
    const paths = extractFilePaths('文件位置： C:\\Users\\Yoi\\Downloads\\memflow-icon.png')
    expect(paths[0]).toBe("C:/Users/Yoi/Downloads/memflow-icon.png")
  })

  it("still matches unix paths", () => {
    const paths = extractFilePaths("/tmp/chart.png")
    expect(paths).toContain("/tmp/chart.png")
  })
})

describe("extractFilePaths document files", () => {
  it("detects PDF files", () => {
    const paths = extractFilePaths("C:/docs/report.pdf")
    expect(paths).toContain("C:/docs/report.pdf")
  })

  it("detects DOCX files", () => {
    const paths = extractFilePaths("C:/docs/contract.docx")
    expect(paths).toContain("C:/docs/contract.docx")
  })

  it("detects XLSX files", () => {
    const paths = extractFilePaths("/home/user/data.xlsx")
    expect(paths).toContain("/home/user/data.xlsx")
  })

  it("detects ZIP files", () => {
    const paths = extractFilePaths("C:/temp/bundle.zip")
    expect(paths).toContain("C:/temp/bundle.zip")
  })

  it("detects MD files", () => {
    const paths = extractFilePaths("/tmp/readme.md")
    expect(paths).toContain("/tmp/readme.md")
  })

  it("detects SVG files", () => {
    const paths = extractFilePaths("/tmp/icon.svg")
    expect(paths).toContain("/tmp/icon.svg")
  })

  it("detects TXT files", () => {
    const paths = extractFilePaths("C:/logs/output.txt")
    expect(paths).toContain("C:/logs/output.txt")
  })

  it("detects JSON files", () => {
    const paths = extractFilePaths("/tmp/data.json")
    expect(paths).toContain("/tmp/data.json")
  })

  it("deduplicates repeated paths", () => {
    const paths = extractFilePaths("C:/docs/report.pdf\nC:/docs/report.pdf")
    expect(paths.filter((p) => p.includes("report.pdf"))).toHaveLength(1)
  })

  it("does not detect .exe files", () => {
    const paths = extractFilePaths("C:/temp/malware.exe")
    expect(paths.some((p) => p.endsWith(".exe"))).toBe(false)
  })

  it("does not detect paths without valid extensions", () => {
    const paths = extractFilePaths("C:/docs/readme")
    expect(paths).toHaveLength(0)
  })
})
