// Thin wrappers over fast-xml-parser, mirroring Go's encoding/xml usage.
import { XMLBuilder, XMLParser } from "fast-xml-parser";

export type XmlRecord = Record<string, unknown>;

const builder = new XMLBuilder({
  ignoreAttributes: true,
  suppressEmptyNode: true,
  format: false,
});

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

/** Equivalent of Go's xml.Marshal for the request bodies used by the non-S3 APIs. */
export function marshalXml(root: XmlRecord): string {
  return builder.build(root);
}

/** Equivalent of Go's xml.Unmarshal into a plain object tree. */
export function parseXml(xml: string): XmlRecord {
  return parser.parse(xml) as XmlRecord;
}
