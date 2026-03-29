import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

const CDNMediaType = {
  Image: 1,
  Video: 2,
  File: 3,
};

const ItemType = {
  Text: 1,
  Image: 2,
  Voice: 3,
  File: 4,
  Video: 5,
};

function generateAESKey() {
  return crypto.randomBytes(16).toString("hex");
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

function pkcs7Pad(data, blockSize) {
  const padLen = blockSize - (data.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, pad]);
}

function encryptAES128ECB(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const padded = pkcs7Pad(data, 16);
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

async function apiPost(baseUrl, endpoint, req, token) {
  const res = await fetch(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${token}`,
      "X-WECHAT-UIN": Buffer.from(String(Math.floor(Math.random() * 0xFFFFFFFF))).toString("base64"),
      "Content-Length": String(Buffer.byteLength(JSON.stringify(req), "utf-8")),
    },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function uploadToCDN(uploadParam, encryptedData) {
  const res = await fetch(uploadParam, {
    method: "POST",
    body: encryptedData,
    headers: {
      "Content-Type": "application/octet-stream",
    },
  });
  if (!res.ok) {
    throw new Error(`CDN upload failed: ${res.status}`);
  }
  const downloadParam = res.headers.get("X-Encrypted-Param");
  if (!downloadParam) {
    throw new Error("CDN upload: missing X-Encrypted-Param header");
  }
  return downloadParam;
}

async function getUploadURL(baseUrl, token, req) {
  return apiPost(baseUrl, "ilink/bot/getuploadurl", req, token);
}

async function sendImageMessage(baseUrl, token, toUserId, clientId, contextToken, aesKeyBase64, encryptQueryParam, size) {
  const request = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{
        type: ItemType.Image,
        image_item: {
          media: {
            aes_key: aesKeyBase64,
            encrypt_query_param: encryptQueryParam,
            encrypt_type: 1,
          },
          mid_size: size,
        },
      }],
    },
    base_info: { channel_version: "1.0.0" },
  };
  return apiPost(baseUrl, "ilink/bot/sendmessage", request, token);
}

async function sendFileMessage(baseUrl, token, toUserId, clientId, contextToken, aesKeyBase64, encryptQueryParam, size, fileName) {
  const request = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{
        type: ItemType.File,
        file_item: {
          media: {
            aes_key: aesKeyBase64,
            encrypt_query_param: encryptQueryParam,
            encrypt_type: 1,
          },
          file_name: fileName,
          len: String(size),
        },
      }],
    },
    base_info: { channel_version: "1.0.0" },
  };
  return apiPost(baseUrl, "ilink/bot/sendmessage", request, token);
}

async function sendVideoMessage(baseUrl, token, toUserId, clientId, contextToken, aesKeyBase64, encryptQueryParam, size) {
  const request = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{
        type: ItemType.Video,
        video_item: {
          media: {
            aes_key: aesKeyBase64,
            encrypt_query_param: encryptQueryParam,
            encrypt_type: 1,
          },
          video_size: size,
        },
      }],
    },
    base_info: { channel_version: "1.0.0" },
  };
  return apiPost(baseUrl, "ilink/bot/sendmessage", request, token);
}

async function uploadAndSend(baseUrl, token, toUserId, filePath, mediaType, itemType, extra = {}) {
  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileKey = crypto.randomBytes(16).toString("hex");
  const aesKey = generateAESKey();
  const encrypted = encryptAES128ECB(fileData, aesKey);
  const fileMd5 = md5(fileData);

  console.log(`  File: ${fileName} (${fileData.length} bytes)`);
  console.log(`  File key: ${fileKey}`);
  console.log(`  AES key: ${aesKey}`);
  console.log(`  Encrypted size: ${encrypted.length}`);

  const uploadResp = await getUploadURL(baseUrl, token, {
    filekey: fileKey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize: fileData.length,
    rawfilemd5: fileMd5,
    filesize: encrypted.length,
    no_need_thumb: true,
    aeskey: aesKey,
    base_info: { channel_version: "1.0.0" },
  });

  if (uploadResp.errcode && uploadResp.errcode !== 0) {
    throw new Error(`getuploadurl failed: errcode=${uploadResp.errcode} errmsg=${uploadResp.errmsg}`);
  }

  let uploadUrl;
  if (uploadResp.upload_full_url) {
    uploadUrl = uploadResp.upload_full_url;
  } else if (uploadResp.upload_param) {
    uploadUrl = `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${uploadResp.upload_param}&filekey=${fileKey}`;
  } else {
    throw new Error("No upload URL in response");
  }

  const downloadParam = await uploadToCDN(uploadUrl, encrypted);
  const aesKeyBase64 = Buffer.from(aesKey, "hex").toString("base64");
  const clientId = `test-${Date.now()}`;

  let resp;
  switch (itemType) {
    case ItemType.Image:
      resp = await sendImageMessage(baseUrl, token, toUserId, clientId, "", aesKeyBase64, downloadParam, fileData.length);
      break;
    case ItemType.File:
      resp = await sendFileMessage(baseUrl, token, toUserId, clientId, "", aesKeyBase64, downloadParam, fileData.length, fileName);
      break;
    case ItemType.Video:
      resp = await sendVideoMessage(baseUrl, token, toUserId, clientId, "", aesKeyBase64, downloadParam, fileData.length);
      break;
    default:
      throw new Error(`Unknown item type: ${itemType}`);
  }

  if (resp.errcode && resp.errcode !== 0) {
    throw new Error(`sendmessage failed: errcode=${resp.errcode} errmsg=${resp.errmsg}`);
  }

  console.log(`  ✅ Sent successfully!`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const testType = args[0] || "all";

  const sessionPath = path.join(__dirname, ".opencode-lark", "wechat-session.json");

  if (!fs.existsSync(sessionPath)) {
    console.error("❌ No session file found. Please login first.");
    process.exit(1);
  }

  const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  console.log("Loaded session:", session.accountId);
  console.log("");

  const testUserId = session.userId;
  const attachmentsDir = path.join(__dirname, ".opencode-lark", "attachments");

  const tests = {
    image: {
      name: "Image (PNG/JPG)",
      mediaType: CDNMediaType.Image,
      itemType: ItemType.Image,
      files: ["test.png", "test_chatgpt.png"].map(f => path.join(attachmentsDir, f)),
    },
    file: {
      name: "File (PDF/TXT)",
      mediaType: CDNMediaType.File,
      itemType: ItemType.File,
      files: [
        path.join(attachmentsDir, "1.《代码随想录》数组（V3.0）.pdf"),
        path.join(attachmentsDir, "1773852768876-72a0-image.png"),
      ].filter(f => fs.existsSync(f)),
    },
    video: {
      name: "Video (MP4)",
      mediaType: CDNMediaType.Video,
      itemType: ItemType.Video,
      files: [
        path.join(attachmentsDir, "news_hotspots_20260328.mp4"),
      ].filter(f => fs.existsSync(f)),
    },
  };

  const runTest = async (name, test) => {
    console.log(`\n=== Testing ${name} ===`);
    if (test.files.length === 0) {
      console.log("  ⏭️  No files found, skipping...");
      return;
    }
    for (const file of test.files) {
      try {
        await uploadAndSend(ILINK_BASE_URL, session.token, testUserId, file, test.mediaType, test.itemType);
      } catch (err) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }
  };

  if (testType === "all") {
    await runTest("Image", tests.image);
    await runTest("File", tests.file);
    await runTest("Video", tests.video);
    console.log("\n✅ All tests completed!");
  } else if (tests[testType]) {
    await runTest(tests[testType].name, tests[testType]);
    console.log("\n✅ Test completed!");
  } else {
    console.error(`Unknown test type: ${testType}`);
    console.log("Usage: bun run test-wechat-image.ts [image|file|video|all]");
    process.exit(1);
  }
}

main();