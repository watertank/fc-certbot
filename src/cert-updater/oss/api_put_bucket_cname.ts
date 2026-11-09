// Translated from pkg/sdk3rd/alibabacloud/oss/api_put_bucket_cname.go.

import { Client } from "./client.ts";
import { type XmlRecord } from "./xml.ts";

export interface PutBucketCnameRequest {
  cname?: PutBucketCnameRequestCname;
}

export interface PutBucketCnameRequestCname {
  domain?: string;
  certificateConfiguration?: PutBucketCnameRequestCnameCertificateConfiguration;
}

export interface PutBucketCnameRequestCnameCertificateConfiguration {
  certId?: string;
  certificate?: string;
  privateKey?: string;
  previousCertId?: string;
  force?: boolean;
  deleteCertificate?: boolean;
}

export type PutBucketCnameResponse = {};

Client.prototype.putBucketCname = async function (
  this: Client,
  req: PutBucketCnameRequest,
): Promise<PutBucketCnameResponse> {
  const cert = req.cname?.certificateConfiguration;
  const payload: XmlRecord = {
    BucketCnameConfiguration: {
      Cname: {
        ...(req.cname?.domain ? { Domain: req.cname.domain } : {}),
        ...(cert
          ? {
              CertificateConfiguration: {
                ...(cert.certId ? { CertId: cert.certId } : {}),
                ...(cert.certificate ? { Certificate: cert.certificate } : {}),
                ...(cert.privateKey ? { PrivateKey: cert.privateKey } : {}),
                ...(cert.previousCertId ? { PreviousCertId: cert.previousCertId } : {}),
                ...(cert.force !== undefined ? { Force: cert.force } : {}),
                ...(cert.deleteCertificate !== undefined ? { DeleteCertificate: cert.deleteCertificate } : {}),
              },
            }
          : {}),
      },
    },
  };

  const pending = this._newRequest("POST", "/?cname&comp=add", payload, `/${this.bucket ?? ""}/`);
  await this._doRequest(pending);

  return {};
};

declare module "./client.ts" {
  interface Client {
    putBucketCname(req: PutBucketCnameRequest): Promise<PutBucketCnameResponse>;
  }
}
