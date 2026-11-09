// OSS V4 request signer (Signature Version 4 / OSS4-HMAC-SHA256).
// Translated from pkg/sdk3rd/alibabacloud/oss/signer.go.
//
// API signing docs:
// https://help.aliyun.com/zh/oss/developer-reference/recommend-to-use-signature-version-4
// https://www.alibabacloud.com/help/en/oss/developer-reference/recommend-to-use-signature-version-4

import { createHash, createHmac } from "node:crypto";
import { HeadersMap } from "./headers.ts";

export interface SignableRequest {
  method: string;
  url: URL;
  headers: HeadersMap;
}

const SIGN_ALGORITHM = "OSS4-HMAC-SHA256";

function hmacSha256(key: string | Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Equivalent of Go's escapeQuery (url.QueryEscape with "+" replaced by "%20"). */
export function escapeQuery(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, "%20")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Equivalent of Go's escapePath: percent-encodes every non-unreserved byte. */
export function escapePath(path: string): string {
  const bytes = Buffer.from(path, "utf8");
  let buf = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!;
    const noEscape =
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      (c >= 0x30 && c <= 0x39) || // 0-9
      c === 0x2d || // -
      c === 0x2e || // .
      c === 0x5f || // _
      c === 0x7e || // ~
      c === 0x2f; // /
    if (noEscape) {
      buf += String.fromCharCode(c);
    } else {
      buf += "%" + c.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return buf;
}

export class Signer {
  constructor(
    private readonly accessKeyId: string,
    private readonly accessKeySecret: string,
    private readonly region: string,
    private readonly securityToken?: string,
  ) {}

  sign(req: SignableRequest, now: Date = new Date()): void {
    const method = req.method.toUpperCase();

    const nowUtc = now;
    const headerDateStr = nowUtc.toUTCString(); // http.TimeFormat: "Mon, 02 Jan 2006 15:04:05 GMT"
    const requestDateStr = nowUtc.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z"; // "20060102T150405Z"
    const signDateStr = requestDateStr.slice(0, 8); // "20060102"

    const requestResStr = req.headers.get("X-API-Resource");
    req.headers.delete("X-API-Resource");

    // STS temporary credentials must send the security token, and the V4
    // signature must cover it (it is an x-oss-* header).
    if (this.securityToken) {
      req.headers.set("X-OSS-Security-Token", this.securityToken);
    }

    // Go's url.Parse decodes URL.Path; escapePath then re-encodes it.
    let decodedPath = req.url.pathname;
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      // keep as-is for malformed escape sequences
    }
    let canonicalUrl = escapePath(decodedPath);
    if (canonicalUrl === "") {
      canonicalUrl = "/";
    }
    if (canonicalUrl === "/" && requestResStr) {
      canonicalUrl = escapePath(requestResStr);
    }

    // Canonical query string: sorted keys, first value per key.
    let canonicalQueryStr = "";
    const queryKeys = [...req.url.searchParams.keys()].sort();
    for (let i = 0; i < queryKeys.length; i++) {
      if (i > 0) {
        canonicalQueryStr += "&";
      }
      const key = queryKeys[i]!;
      const value = req.url.searchParams.get(key) ?? "";
      if (value === "") {
        canonicalQueryStr += escapeQuery(key);
      } else {
        canonicalQueryStr += escapeQuery(key) + "=" + escapeQuery(value);
      }
    }

    let canonicalHeaders = "";
    if (req.headers.size > 0) {
      if (!req.headers.has("X-OSS-Date")) {
        req.headers.set("X-OSS-Date", requestDateStr);
      }
      if (!req.headers.has("X-OSS-Content-SHA256")) {
        req.headers.set("X-OSS-Content-SHA256", "UNSIGNED-PAYLOAD");
      }

      const keys: string[] = [];
      for (const key of req.headers.keys()) {
        const lower = key.toLowerCase();
        if (lower.startsWith("x-oss-")) {
          keys.push(lower);
        }
        if (lower === "content-type" || lower === "content-md5") {
          keys.push(lower);
        }
      }
      keys.sort();

      for (let i = 0; i < keys.length; i++) {
        if (i > 0) {
          canonicalHeaders += "\n";
        }
        const value = (req.headers.get(keys[i]!) ?? "").trim();
        canonicalHeaders += keys[i] + ":" + value;
      }
      canonicalHeaders += "\n";
    }

    const hashedPayload = req.headers.get("X-OSS-Content-SHA256") ?? "UNSIGNED-PAYLOAD";

    const canonicalRequest = [method, canonicalUrl, canonicalQueryStr, canonicalHeaders, "", hashedPayload].join("\n");
    const canonicalRequestHash = createHash("sha256").update(canonicalRequest).digest("hex").toLowerCase();

    const scope = `${signDateStr}/${this.region}/oss/aliyun_v4_request`;
    const stringToSign = [SIGN_ALGORITHM, requestDateStr, scope, canonicalRequestHash].join("\n");

    const kDate = hmacSha256("aliyun_v4" + this.accessKeySecret, signDateStr);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, "oss");
    const kSigning = hmacSha256(kService, "aliyun_v4_request");
    const signature = hmacSha256(kSigning, stringToSign).toString("hex").toLowerCase();

    const authorization = `${SIGN_ALGORITHM} Credential=${this.accessKeyId}/${scope}, Signature=${signature}`;

    req.headers.set("Authorization", authorization);
    req.headers.set("Date", headerDateStr);
  }
}
