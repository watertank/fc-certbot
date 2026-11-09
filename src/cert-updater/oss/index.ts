export { Client } from "./client.ts";
export type { PendingRequest, DoRequestResult } from "./client.ts";
export { HeadersMap } from "./headers.ts";
export type { Options } from "./options.ts";
export { Signer, escapePath, escapeQuery } from "./signer.ts";
export type { SignableRequest } from "./signer.ts";
export { marshalXml, parseXml } from "./xml.ts";
export type { XmlRecord } from "./xml.ts";

export * from "./api_put_bucket_cname.ts";
export * from "./api_list_bucket_cname.ts";
