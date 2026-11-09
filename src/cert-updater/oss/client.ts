// A simple SDK client for AlibabaCloud OSS.
// Translated from pkg/sdk3rd/alibabacloud/oss/client.go.
// API documentation: https://www.alibabacloud.com/help/en/oss/developer-reference/list-of-operations-by-function

import { createHash } from "node:crypto";
import { HeadersMap } from "./headers.ts";
import { type Options } from "./options.ts";
import { Signer } from "./signer.ts";
import { marshalXml, parseXml, type XmlRecord } from "./xml.ts";

const DEFAULT_USER_AGENT = "ali-oss-ts/0.1.0";

export interface PendingRequest {
  method: string;
  url: URL;
  headers: HeadersMap;
  body?: string;
}

export interface DoRequestResult {
  resp: Response;
  result: XmlRecord;
}

export class Client {
  readonly bucket?: string;
  private readonly baseUrl: string;
  private readonly signer: Signer;
  private defaultHeaders = new HeadersMap();
  private userAgent: string = DEFAULT_USER_AGENT;
  private timeoutMs: number = 0;

  constructor(opts: Options) {
    if (opts.region === "") {
      throw new Error("sdkerr: unset region");
    }
    if (opts.accessKeyId === "") {
      throw new Error("sdkerr: unset accessKeyId");
    }
    if (opts.accessKeySecret === "") {
      throw new Error("sdkerr: unset secretAccessKey");
    }

    let endpoint = opts.endpoint ?? "";
    if (endpoint === "") {
      if (!opts.bucket) {
        endpoint = `https://oss-${encodeURIComponent(opts.region)}.aliyuncs.com`;
      } else {
        endpoint = `https://${encodeURIComponent(opts.bucket)}.oss-${encodeURIComponent(opts.region)}.aliyuncs.com`;
      }
    } else {
      try {
        new URL(endpoint);
      } catch {
        endpoint = "https://" + endpoint;
      }
    }

    this.bucket = opts.bucket;
    this.baseUrl = endpoint;
    this.signer = new Signer(opts.accessKeyId, opts.accessKeySecret, opts.region, opts.securityToken);
  }

  setUserAgent(userAgent: string): this {
    this.userAgent = userAgent;
    return this;
  }

  setDefaultHeaders(headers: HeadersMap): this {
    this.defaultHeaders = headers;
    return this;
  }

  setTimeout(timeoutMs: number): this {
    this.timeoutMs = timeoutMs;
    return this;
  }

  /**
   * Builds a request without sending it.
   * WARN:
   *   Use `newRequest` to create requests; the returned request must be sent
   *   through `doRequest` / `doRequestWithResult` so it gets signed.
   */
  _newRequest(
    method: string,
    path: string,
    params?: XmlRecord | string | null,
    xOssResource?: string,
  ): PendingRequest {
    if (method === "") {
      throw new Error("sdkerr: unset method");
    }
    if (path === "") {
      throw new Error("sdkerr: unset path");
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(path, this.baseUrl);
    } catch {
      throw new Error("sdkerr: invalid path");
    }
    if (requestUrl.origin !== new URL(this.baseUrl).origin) {
      throw new Error("sdkerr: path should be relative");
    }

    let payloadStr = "";
    let contentType = "";
    if (params != null) {
      // Currently only XML request bodies are supported (non-S3-compatible interfaces).
      if (typeof params === "string") {
        payloadStr = params;
      } else {
        payloadStr = marshalXml(params);
      }
      contentType = "application/xml";
    }
    const payloadMd5 = createHash("md5").update(payloadStr, "utf8").digest("base64");

    const headers = new HeadersMap();
    for (const [key, values] of this.defaultHeaders.toMap()) {
      for (const v of values) {
        headers.add(key, v);
      }
    }
    headers.set("Content-MD5", payloadMd5);
    if (contentType !== "") {
      headers.set("Content-Type", contentType);
    }
    headers.set("X-API-Resource", xOssResource ?? "");

    return { method, url: requestUrl, headers, body: payloadStr === "" ? undefined : payloadStr };
  }

  async _doRequest(req: PendingRequest): Promise<Response> {
    if (!req) {
      throw new Error("sdkerr: nil request");
    }

    this.signer.sign(req);

    const init: RequestInit = {
      method: req.method,
      headers: { ...req.headers.toObject(), "User-Agent": this.userAgent },
    };
    if (req.body) {
      init.body = req.body;
    }
    if (this.timeoutMs > 0) {
      init.signal = AbortSignal.timeout(this.timeoutMs);
    }

    let resp: Response;
    try {
      resp = await fetch(req.url.toString(), init);
    } catch (err) {
      throw new Error(`sdkerr: failed to send request: ${(err as Error).message}`);
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`sdkerr: unexpected status code: ${resp.status} (resp: ${text})`);
    }
    return resp;
  }

  async _doRequestWithResult(req: PendingRequest): Promise<DoRequestResult> {
    if (!req) {
      throw new Error("sdkerr: nil request");
    }

    const resp = await this._doRequest(req);

    const text = await resp.text();
    let result: XmlRecord = {};
    if (text !== "") {
      try {
        result = parseXml(text);
      } catch (err) {
        throw new Error(`sdkerr: failed to unmarshal response: ${(err as Error).message} (resp: ${text})`);
      }
    }

    return { resp, result };
  }
}
