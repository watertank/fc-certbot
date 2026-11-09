// ListBucketCname: queries the custom domain (CNAME) list bound to a bucket.
// API: GET /?cname&comp=list
// Docs: https://help.aliyun.com/zh/oss/developer-reference/listcname

import { Client } from "./client.ts";
import { type XmlRecord } from "./xml.ts";

export interface ListBucketCnameCertificate {
  type?: string;
  certId?: string;
  status?: string;
  creationDate?: string;
  fingerprint?: string;
  validStartDate?: string;
  validEndDate?: string;
}

export interface ListBucketCnameCname {
  domain?: string;
  lastModified?: string;
  status?: string;
  certificate?: ListBucketCnameCertificate;
}

export interface ListBucketCnameResponse {
  bucket?: string;
  owner?: string;
  cname?: ListBucketCnameCname[];
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  return String(v);
}

function asRecord(v: unknown): XmlRecord | undefined {
  if (typeof v !== "object" || v === null) {
    return undefined;
  }
  return (Array.isArray(v) ? v[0] : v) as XmlRecord;
}

Client.prototype.listBucketCname = async function (this: Client): Promise<ListBucketCnameResponse> {
  const pending = this._newRequest("GET", "/?cname&comp=list", null, `/${this.bucket ?? ""}/`);
  const { result } = await this._doRequestWithResult(pending);

  const root = asRecord(result["ListCnameResult"]);
  if (!root) {
    return {};
  }

  const rawCnames = root["Cname"];
  const rawList = rawCnames === undefined ? [] : Array.isArray(rawCnames) ? rawCnames : [rawCnames];

  const cnames: ListBucketCnameCname[] = [];
  for (const raw of rawList) {
    const c = asRecord(raw);
    if (!c) {
      continue;
    }
    const cert = asRecord(c["Certificate"]);
    cnames.push({
      domain: str(c["Domain"]),
      lastModified: str(c["LastModified"]),
      status: str(c["Status"]),
      certificate: cert
        ? {
            type: str(cert["Type"]),
            certId: str(cert["CertId"]),
            status: str(cert["Status"]),
            creationDate: str(cert["CreationDate"]),
            fingerprint: str(cert["Fingerprint"]),
            validStartDate: str(cert["ValidStartDate"]),
            validEndDate: str(cert["ValidEndDate"]),
          }
        : undefined,
    });
  }

  return {
    bucket: str(root["Bucket"]),
    owner: str(root["Owner"]),
    cname: cnames.length > 0 ? cnames : undefined,
  };
};

declare module "./client.ts" {
  interface Client {
    listBucketCname(): Promise<ListBucketCnameResponse>;
  }
}
