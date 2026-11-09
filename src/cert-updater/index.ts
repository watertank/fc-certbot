const CERT_PREFIX = "devs-certbot-generated-";
const CERT_WILDCARD_PREFIX = "devs-certbot-generated-w-";

import cdn20180510, { DescribeCdnCertificateDetailRequest, DescribeCdnCertificateDetailResponseBody, DescribeCdnHttpsDomainListRequest, DescribeCdnHttpsDomainListResponseBodyCertInfosCertInfo, SetCdnDomainSSLCertificateRequest } from "@alicloud/cdn20180510";
import FC20230330, { CertConfig, CustomDomain, InvokeFunctionHeaders, InvokeFunctionRequest, ListCustomDomainsRequest, UpdateCustomDomainInput, UpdateCustomDomainRequest } from "@alicloud/fc20230330";
import cas20200407, { GetUserCertificateDetailRequest, GetUserCertificateDetailResponse } from "@alicloud/cas20200407";
import { Config } from "@alicloud/openapi-client";
import Util, { RuntimeOptions } from "@alicloud/tea-util";
import Stream from "@alicloud/darabonba-stream";
import _ from "lodash";
import { Client as OssClient, type ListBucketCnameCname, type ListBucketCnameResponse, type PutBucketCnameRequest } from "./oss";

const runtime = new RuntimeOptions({});

let CERT_GENERATOR_FUNCTION_NAME: string;

type Credentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export type FcContext = {
  accountId: string;
  region: string; // region of this function
  credentials: Credentials;
}

type CdnDomain = {
  certInfo: DescribeCdnHttpsDomainListResponseBodyCertInfosCertInfo;
  certDetail: DescribeCdnCertificateDetailResponseBody;
}

function getCdnEndpoint(regionId: string) {
  // https://api.aliyun.com/product/Cdn?tab=endpoints
  if (regionId.startsWith("ap-southeast-")) {
    return "cdn.ap-southeast-1.aliyuncs.com";
  } else {
    return "cdn.aliyuncs.com";
  }
}

function getCdnClient(context: FcContext) {
  return new cdn20180510(
    new Config({
      accessKeyId: context.credentials.accessKeyId,
      accessKeySecret: context.credentials.accessKeySecret,
      securityToken: context.credentials.securityToken,
      endpoint: getCdnEndpoint(context.region),
      readTimeout: 1000000,
      connectTimeout: 1000000,
    })
  );
}

function getOssClient(regionId: string, context: FcContext) {
  let endpoint = `oss-${regionId}${(regionId === context.region) ? "-internal" : ""}.aliyuncs.com`;
  return new OssClient({
    accessKeyId: context.credentials.accessKeyId,
    accessKeySecret: context.credentials.accessKeySecret,
    region: regionId,
    endpoint: endpoint,
  });
}

function getFcClient(regionId: string, context: FcContext) {
  let endpoint = `${context.accountId}.${regionId}${(regionId === context.region) ? "-internal" : ""}.fc.aliyuncs.com`;
  return new FC20230330(
    new Config({
      accessKeyId: context.credentials.accessKeyId,
      accessKeySecret: context.credentials.accessKeySecret,
      securityToken: context.credentials.securityToken,
      endpoint,
      readTimeout: 1000000,
      connectTimeout: 1000000,
    })
  );
}

function getCasClient(context: FcContext) {
  return new cas20200407(
    new Config({
      accessKeyId: context.credentials.accessKeyId,
      accessKeySecret: context.credentials.accessKeySecret,
      securityToken: context.credentials.securityToken,
      endpoint: "cas.aliyuncs.com",
      readTimeout: 1000000,
      connectTimeout: 1000000,
    })
  );
}

async function listCustomDomains(regionId: string, context: FcContext) {
  const client = getFcClient(regionId, context);
  let nextToken = "";
  let stop = false;
  const out: CustomDomain[] = [];
  while (!stop) {
    const result = await client.listCustomDomainsWithOptions(
      new ListCustomDomainsRequest({
        nextToken,
        limit: 100,
      }),
      {},
      runtime
    );
    out.push(
      ...result.body!.customDomains!.filter((customDomain) => {
        const { protocol, certConfig } = customDomain;
        if (
          protocol!.toLocaleLowerCase().includes("https") &&
          certConfig!.certName!.startsWith(CERT_PREFIX)
        ) {
          customDomain.regionId = regionId;
          return true;
        } else {
          return false;
        }
      })
    );
    if (result.body!.nextToken) {
      nextToken = result.body!.nextToken;
    } else {
      stop = true;
    }
  }

  return out;
}

async function updateCustomDomain(customDomain: CustomDomain, certName: string, certInfo: GetUserCertificateDetailResponse, context: FcContext) {
  const client = getFcClient(customDomain.regionId, context);
  const request = new UpdateCustomDomainRequest();
  const input = new UpdateCustomDomainInput();
  const certConfig = new CertConfig();
  certConfig.certName = certName;
  certConfig.certificate = certInfo.body!.cert;
  certConfig.privateKey = certInfo.body!.key;
  input.certConfig = certConfig;
  request.body = input;
  await client.updateCustomDomainWithOptions(customDomain.domainName!, request, {}, runtime);
  console.log(`fc: update ${customDomain.domainName} success`);
}

async function updateCustomDomains(certName: string, customDomains: CustomDomain[], context: FcContext) {
  const fcClient = getFcClient(context.region, context);
  const casClient = getCasClient(context);
  const domainNames = _.uniq(
    customDomains.map((customDomain) => customDomain.domainName!)
  );
  let domainName = domainNames[0]!;
  if (certName.startsWith(CERT_WILDCARD_PREFIX)) {
    const wildcardPosition = Number(certName.split("-")[4]);
    domainName = `*.${domainName
      .split(".")
      .slice(-1 * (wildcardPosition - 1))
      .join(".")}`;
  }
  const result = await fcClient.invokeFunctionWithOptions(
    CERT_GENERATOR_FUNCTION_NAME,
    new InvokeFunctionRequest({
      body: Stream.readFromString(
        JSON.stringify({
          certName,
          domainName,
        })
      ),
    }),
    new InvokeFunctionHeaders({
      xFcInvocationType: "Sync",
    }),
    runtime
  );
  if (!result.headers!["x-fc-error-type"]) {
    const certId = await Util.readAsString(result.body!);
    if (certId) {
      const certInfo = await casClient.getUserCertificateDetailWithOptions(
        new GetUserCertificateDetailRequest({
          certId: certId,
        }),
        runtime
      );
      await Promise.all([
        ...customDomains
          .filter((customDomain) => {
            if (customDomain.certConfig!.certificate !== certInfo.body!.cert) {
              return true;
            } else {
              console.log(
                `No need to update ${customDomain.domainName} because it already has the latest cert`
              );
              return false;
            }
          })
          .map((customDomain) =>
            updateCustomDomain(customDomain, certName, certInfo, context)
          ),
      ]);
    } else {
      throw new Error(`Failed to find cert ${certName}`);
    }
  } else {
    throw new Error(`Failed to check cert ${certName}`);
  }
}

async function handleCustomDomains(context: FcContext) {
  const out1 = await Promise.all(
    process.env.CUSTOM_DOMAIN_REGIONS!.split(",").map((regionId) =>
      listCustomDomains(regionId, context)
    )
  );
  const out = out1.flat();
  const map: Record<string, CustomDomain[]> = {};
  out.forEach((c) => {
    const certName = c.certConfig!.certName!;
    if (map[certName]) {
      map[certName].push(c);
    } else {
      map[certName] = [c];
    }
  });

  const requests: Promise<void>[] = [];
  if (Object.keys(map).length === 0) {
    console.log("fc: no fc-certbot app created certs found");
  }
  Object.keys(map).forEach(async (certName) => {
    const customDomains = map[certName]!;
    console.log(
      `found cert ${certName} is used by custom domains: ${customDomains
        .map((c) => c.domainName)
        .join(", ")}.`
    );
    requests.push(updateCustomDomains(certName, customDomains, context));
  });
  await Promise.all(requests);
}

async function listCdnDomains(context: FcContext) {
  const client = getCdnClient(context);
  const request = new DescribeCdnHttpsDomainListRequest();
  // TODO: paging
  request.pageSize = 100;
  const result = await client.describeCdnHttpsDomainListWithOptions(request, runtime);
  if (!result.body?.certInfos?.certInfo) {
    return [];
  }
  const map: Record<string, DescribeCdnHttpsDomainListResponseBodyCertInfosCertInfo[]> = {};
  for (const certInfo of result.body.certInfos.certInfo) {
    const certName = certInfo.certName!;
    if (!certName.startsWith(CERT_PREFIX)) {
      continue;
    }
    if (map[certName]) {
      map[certName].push(certInfo);
    } else {
      map[certName] = [certInfo];
    }
  }
  const map1: Record<string, DescribeCdnCertificateDetailResponseBody> = {};
  for (const certName of Object.keys(map)) {
    const req = new DescribeCdnCertificateDetailRequest();
    req.certName = certName;
    const resp = await client.describeCdnCertificateDetailWithOptions(req, runtime);
    map1[certName] = resp.body!;
  }
  const out: CdnDomain[] = [];
  for (const certInfo of result.body.certInfos.certInfo) {
    const certName = certInfo.certName!;
    if (!certName.startsWith(CERT_PREFIX)) {
      continue;
    }
    out.push({
      certInfo: certInfo,
      certDetail: map1[certName]!,
    })
  }
  return out;
}

async function updateCdnDomain(domainName: string, certName: string, certInfo: GetUserCertificateDetailResponse, context: FcContext) {
  const client = getCdnClient(context);
  const request = new SetCdnDomainSSLCertificateRequest();
  request.domainName = domainName;
  // NOTE: should certId and certName, otherwise this request will create new cas cert with name not starts with CERT_PREFIX
  request.certId = certInfo.body!.id;
  request.certName = certName;
  request.SSLProtocol = "on";
  // XXX: SSLPub = body.cert?
  // request.SSLPub = certInfo.body!.cert;
  // request.SSLPri = certInfo.body!.key;
  await client.setCdnDomainSSLCertificateWithOptions(request, runtime);
  console.log(`cdn: update cert for ${domainName} success`);
}

function willExpireWithin(a: Date, days: number, now: Date = new Date()): boolean {
  const ta = a.getTime();
  const tn = now.getTime();
  if (Number.isNaN(ta) || Number.isNaN(tn)) {
    throw new TypeError('Invalid Date');
  }
  const DAY = 24 * 60 * 60 * 1000;
  return tn < ta && tn + days * DAY >= ta;
}

function shouldUpdateCdnDomain(cdnDomain: CdnDomain, certInfo: GetUserCertificateDetailResponse): boolean {
  if (cdnDomain.certInfo.certStatus === "expired") {
    return true;
  }
  if (cdnDomain.certInfo.certExpireTime) {
    const expireTime = new Date(cdnDomain.certInfo.certExpireTime);
    // NOTE: 3 < 7 days in cert-generator(check_if_less_than_seven_days)
    if (willExpireWithin(expireTime, 3)) {
      return true;
    }
  }
  // XXX: always equals
  if (cdnDomain.certDetail!.cert !== certInfo.body!.cert) {
    return true;
  }
  return false;
}

async function updateCdnDomains(certName: string, cdnDomains: CdnDomain[], context: FcContext) {
  const fcClient = getFcClient(context.region, context);
  const casClient = getCasClient(context);
  const domainNames = _.uniq(
    cdnDomains.map((cdnDomain) => cdnDomain.certInfo.domainName!)
  );
  let domainName = domainNames[0]!;
  if (certName.startsWith(CERT_WILDCARD_PREFIX)) {
    const wildcardPosition = Number(certName.split("-")[4]);
    domainName = `*.${domainName
      .split(".")
      .slice(-1 * (wildcardPosition - 1))
      .join(".")}`;
  }
  const result = await fcClient.invokeFunctionWithOptions(
    CERT_GENERATOR_FUNCTION_NAME,
    new InvokeFunctionRequest({
      body: Stream.readFromString(
        JSON.stringify({
          certName,
          domainName,
        })
      ),
    }),
    new InvokeFunctionHeaders({
      xFcInvocationType: "Sync",
    }),
    runtime
  );
  if (!result.headers!["x-fc-error-type"]) {
    const certId = await Util.readAsString(result.body!);
    if (certId) {
      const certInfo = await casClient.getUserCertificateDetailWithOptions(
        new GetUserCertificateDetailRequest({
          certId: certId,
        }),
        runtime
      );
      await Promise.all([
        ...cdnDomains
          .filter((cdnDomain) => {
            if (shouldUpdateCdnDomain(cdnDomain, certInfo)) {
              return true;
            } else {
              console.log(
                `No need to update ${cdnDomain.certInfo.domainName} because it already has the latest cert`
              );
              return false;
            }
          })
          .map((cdnDomain) =>
            updateCdnDomain(cdnDomain.certInfo.domainName!, certName, certInfo, context)
          ),
      ]);
    } else {
      throw new Error(`Failed to find cert ${certName}`);
    }
  } else {
    throw new Error(`Failed to check cert ${certName}`);
  }
}

async function handleCdnDomains(context: FcContext) {
  const out = await listCdnDomains(context);
  const map: Record<string, CdnDomain[]> = {};
  out.forEach((c) => {
    const certName = c.certInfo.certName!;
    if (map[certName]) {
      map[certName].push(c);
    } else {
      map[certName] = [c];
    }
  });

  const requests: Promise<void>[] = [];
  if (Object.keys(map).length === 0) {
    console.log("cdn: no fc-certbot app created certs found");
  }
  Object.keys(map).forEach(async (certName) => {
    const cdnDomains = map[certName]!;
    console.log(
      `found cert ${certName} is used by cdn domains: ${cdnDomains
        .map((c) => c.certInfo.domainName!)
        .join(", ")}.`
    );
    requests.push(updateCdnDomains(certName, cdnDomains, context));
  });
  await Promise.all(requests);
}

async function listOssDomains(regionId: string, context: FcContext) {
  const client = getOssClient(regionId, context);
  const result = await client.listBucketCname();
  return result.cname || [];
}

async function updateOssDomain(domainName: string, certName: string, certInfo: GetUserCertificateDetailResponse, context: FcContext) {
  const client = getOssClient("", context);
  const request: PutBucketCnameRequest = {
    cname: {
      domain: domainName,
    }
  };
  await client.putBucketCname(request);
  console.log(`oss: update cert for ${domainName} success`);
}

async function updateOssDomains(certName: string, domains: ListBucketCnameCname[], context: FcContext) {
  const fcClient = getFcClient(context.region, context);
  const casClient = getCasClient(context);
  const domainNames = _.uniq(
    domains.map((domain) => domain.domain!)
  );
  let domainName = domainNames[0]!;
  if (certName.startsWith(CERT_WILDCARD_PREFIX)) {
    const wildcardPosition = Number(certName.split("-")[4]);
    domainName = `*.${domainName
      .split(".")
      .slice(-1 * (wildcardPosition - 1))
      .join(".")}`;
  }
  const result = await fcClient.invokeFunctionWithOptions(
    CERT_GENERATOR_FUNCTION_NAME,
    new InvokeFunctionRequest({
      body: Stream.readFromString(
        JSON.stringify({
          certName,
          domainName,
        })
      ),
    }),
    new InvokeFunctionHeaders({
      xFcInvocationType: "Sync",
    }),
    runtime
  );
  if (!result.headers!["x-fc-error-type"]) {
    const certId = await Util.readAsString(result.body!);
    if (certId) {
      const certInfo = await casClient.getUserCertificateDetailWithOptions(
        new GetUserCertificateDetailRequest({
          certId: certId,
        }),
        runtime
      );
      await Promise.all([
        ...domains
          .filter((domain) => {
            if (domain.certificate!.certId !== certInfo.body!.cert) {
              return true;
            } else {
              console.log(
                `No need to update ${domain.domain} because it already has the latest cert`
              );
              return false;
            }
          })
          .map((domain) =>
            updateOssDomain(domain.domain!, certName, certInfo, context)
          ),
      ]);
    } else {
      throw new Error(`Failed to find cert ${certName}`);
    }
  } else {
    throw new Error(`Failed to check cert ${certName}`);
  }
}

async function handleOssDomains(context: FcContext) {
  const out1 = await Promise.all(
    process.env.OSS_REGIONS!.split(",").map((regionId) =>
      listOssDomains(regionId, context)
    )
  );
  const out = out1.flat();
  const map: Record<string, ListBucketCnameCname[]> = {};
  out.forEach((c) => {
    const certName = c.certificate!.certId!;
    if (map[certName]) {
      map[certName].push(c);
    } else {
      map[certName] = [c];
    }
  });

  const requests: Promise<void>[] = [];
  if (Object.keys(map).length === 0) {
    console.log("oss: no fc-certbot app created certs found");
  }
  Object.keys(map).forEach(async (certName) => {
    const domain = map[certName]!;
    console.log(
      `found cert ${certName} is used by oss domains: ${domain
        .map((c) => c.domain!)
        .join(", ")}.`
    );
    requests.push(updateOssDomains(certName, domain, context));
  });
  await Promise.all(requests);
}

export async function handler(event: any, context: FcContext, callback: (arg0: null, arg1: string) => void) {
  CERT_GENERATOR_FUNCTION_NAME = process.env.CERT_GENERATOR_FUNCTION_NAME!;
  await handleCustomDomains(context);
  await handleCdnDomains(context);
  // await handleOssDomains(context);
  callback(null, "done");
};
