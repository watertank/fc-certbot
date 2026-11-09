// Ported from the official AlibabaCloud OSS Go SDK V4 signer tests:
// https://github.com/aliyun/alibabacloud-oss-go-sdk-v2/blob/master/oss/signer/signer_test.go
// (TestV4AuthHeader and TestV4AuthHeaderToken).
//
// The CNAME case is cross-checked against ali-oss signUtils.authorizationV4.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { HeadersMap } from "./headers.ts";
import { Signer } from "./signer.ts";

const AK = "ak";
const SK = "sk";
const REGION = "cn-hangzhou";
const SIGN_ALGORITHM = "OSS4-HMAC-SHA256";

function sign(
  method: string,
  url: string,
  headers: HeadersMap,
  signer: Signer,
  time: string,
) {
  const req = { method, url: new URL(url), headers };
  signer.sign(req, new Date(time));
  return req;
}

function signatureOf(authorization: string | undefined): string | undefined {
  return authorization?.match(/,Signature=([0-9a-f]+)$/)?.[1];
}

describe("Signer V4", () => {
  test("matches the official auth-header test vector", () => {
    const headers = new HeadersMap();
    headers.set("x-oss-head1", "value");
    headers.set("abc", "value");
    headers.set("ZAbc", "value");
    headers.set("XYZ", "value");
    headers.set("content-type", "text/plain");
    headers.set("x-oss-content-sha256", "UNSIGNED-PAYLOAD");
    headers.set("X-API-Resource", "/bucket/1234+-/123/1.txt");

    // Go's url.Values.Encode() output, including empty values and keys that
    // must not be decoded before sorting.
    const rawQuery =
      "%2Bparam1=value3&%2Bparam2=&param1=value1&param2=&%7Cparam1=value4&%7Cparam2=";

    sign(
      "PUT",
      `http://bucket.oss-cn-hangzhou.aliyuncs.com/?${rawQuery}`,
      headers,
      new Signer(AK, SK, REGION),
      "2023-12-16T16:20:57Z",
    );

    expect(headers.get("Authorization")).toBe(
      `${SIGN_ALGORITHM} Credential=ak/20231216/cn-hangzhou/oss/aliyun_v4_request,Signature=e21d18daa82167720f9b1047ae7e7f1ce7cb77a31e8203a7d5f4624fa0284afe`,
    );
  });

  test("matches the official auth-header test vector with a security token", () => {
    const headers = new HeadersMap();
    headers.set("x-oss-head1", "value");
    headers.set("abc", "value");
    headers.set("ZAbc", "value");
    headers.set("XYZ", "value");
    headers.set("content-type", "text/plain");
    headers.set("x-oss-content-sha256", "UNSIGNED-PAYLOAD");
    headers.set("X-API-Resource", "/bucket/1234+-/123/1.txt");

    const rawQuery =
      "%2Bparam1=value3&%2Bparam2=&param1=value1&param2=&%7Cparam1=value4&%7Cparam2=";

    sign(
      "PUT",
      `http://bucket.oss-cn-hangzhou.aliyuncs.com/?${rawQuery}`,
      headers,
      new Signer(AK, SK, REGION, "token"),
      "2023-12-17T03:47:36Z",
    );

    expect(headers.get("x-oss-security-token")).toBe("token");
    expect(headers.get("Authorization")).toBe(
      `${SIGN_ALGORITHM} Credential=ak/20231217/cn-hangzhou/oss/aliyun_v4_request,Signature=b94a3f999cf85bcdc00d332fbd3734ba03e48382c36fa4d5af5df817395bd9ea`,
    );
  });

  test("signs listBucketCname with a security token", () => {
    const headers = new HeadersMap();
    headers.set("Content-MD5", createHash("md5").update("", "utf8").digest("base64"));
    headers.set("X-API-Resource", "/examplebucket/");

    sign(
      "GET",
      "https://examplebucket.oss-cn-hangzhou.aliyuncs.com/?cname&comp=list",
      headers,
      new Signer(AK, SK, REGION, "token"),
      "2026-01-02T03:04:05Z",
    );

    expect(headers.get("x-oss-security-token")).toBe("token");
    // Cross-checked with ali-oss signUtils.authorizationV4.
    expect(headers.get("Authorization")).toBe(
      `${SIGN_ALGORITHM} Credential=ak/20260102/cn-hangzhou/oss/aliyun_v4_request,Signature=091ae61801de64b7f09ff8183d02346931d154be732c300c852089d4df430592`,
    );
  });

  test("security token affects the signature", () => {
    const makeHeaders = () => {
      const headers = new HeadersMap();
      headers.set("X-API-Resource", "/examplebucket/");
      return headers;
    };

    const withoutToken = makeHeaders();
    sign(
      "GET",
      "https://examplebucket.oss-cn-hangzhou.aliyuncs.com/?cname&comp=list",
      withoutToken,
      new Signer(AK, SK, REGION),
      "2026-01-02T03:04:05Z",
    );

    const withToken = makeHeaders();
    sign(
      "GET",
      "https://examplebucket.oss-cn-hangzhou.aliyuncs.com/?cname&comp=list",
      withToken,
      new Signer(AK, SK, REGION, "token"),
      "2026-01-02T03:04:05Z",
    );

    expect(withoutToken.has("x-oss-security-token")).toBe(false);
    expect(withToken.has("x-oss-security-token")).toBe(true);
    expect(signatureOf(withoutToken.get("Authorization"))).not.toBe(
      signatureOf(withToken.get("Authorization")),
    );
  });
});
