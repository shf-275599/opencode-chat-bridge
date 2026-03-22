import { extractFilePaths } from "../handler/outbound-media.ts"
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
