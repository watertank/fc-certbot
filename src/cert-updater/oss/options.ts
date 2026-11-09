// Adapted from pkg/sdk3rd/alibabacloud/oss/options.go.
// The original used Go-style functional options; here the client takes a
// plain config object instead.

export interface Options {
  accessKeyId: string;
  accessKeySecret: string;
  /** Optional STS security token, required when using temporary credentials. */
  securityToken?: string;
  region: string;
  bucket?: string;
  /** Optional endpoint, e.g. `https://oss-cn-hangzhou.aliyuncs.com` or a custom domain. Defaults to auto-built from bucket + region. */
  endpoint?: string;
}
