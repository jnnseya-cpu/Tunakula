/**
 * Printed documents carry two logos (product rule, 2026-10-04): the Tunakula
 * brand logo and the issuing business's own logo — on receipts, order labels,
 * invoices, kitchen tickets, till reports, collection slips and statements.
 *
 * Every printable document is built here, so no surface can print one
 * without both. Printer drivers (thermal ESC/POS, PDF, label printers) are
 * adapters that render a `PrintDocument`; they never compose headers.
 */
import type { Brand } from "../config/brand.ts";
import type { BusinessAccount } from "../identity/accounts.ts";

export const PRINT_DOCUMENT_KINDS = [
  "RECEIPT",
  "ORDER_LABEL",
  "INVOICE",
  "KITCHEN_TICKET",
  "COLLECTION_SLIP",
  "BOOKING_CONFIRMATION",
  "CASH_DRAWER_REPORT",
  "PAYOUT_STATEMENT",
] as const;
export type PrintDocumentKind = (typeof PRINT_DOCUMENT_KINDS)[number];

export type LogoSlot =
  | { readonly type: "IMAGE"; readonly assetId: string; readonly alt: string }
  /** The business has not uploaded a logo yet: its name is printed in the logo position. */
  | { readonly type: "TEXT"; readonly text: string };

export interface PrintHeader {
  /** Tunakula (the market's brand) — always an image. */
  readonly platformLogo: Extract<LogoSlot, { type: "IMAGE" }>;
  /** The issuing business. */
  readonly businessLogo: LogoSlot;
  readonly businessName: string;
}

export interface PrintLine {
  readonly text: string;
  readonly emphasis?: "bold" | "large";
  readonly align?: "left" | "centre" | "right";
}

export interface PrintDocument {
  readonly kind: PrintDocumentKind;
  readonly header: PrintHeader;
  readonly body: readonly PrintLine[];
  /** Scannable payload (signed label token, receipt QR), if any. */
  readonly code?: { readonly format: "QR" | "CODE128"; readonly payload: string };
  readonly paperWidthMm: 58 | 80 | 210;
  readonly warnings: readonly PrintWarning[];
}

export type PrintWarning = { readonly code: "BUSINESS_LOGO_MISSING"; readonly accountId: string };

export class PrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintError";
  }
}

/** Resolves the two-logo header for a business printing under a market's brand. */
export function printHeader(platformBrand: Brand, business: BusinessAccount): { header: PrintHeader; warnings: PrintWarning[] } {
  if (!platformBrand.logos.print) throw new PrintError(`Brand ${platformBrand.id} has no print logo`);
  if (business.status === "DELETED") throw new PrintError("A deleted business cannot issue documents");
  const logo = business.images.profile;
  return {
    header: {
      platformLogo: { type: "IMAGE", assetId: platformBrand.logos.print, alt: platformBrand.name },
      businessLogo: logo ? { type: "IMAGE", assetId: logo.assetId, alt: business.name } : { type: "TEXT", text: business.name },
      businessName: business.name,
    },
    // The sale is never blocked for want of a logo; the merchant is prompted to add one.
    warnings: logo ? [] : [{ code: "BUSINESS_LOGO_MISSING", accountId: business.id }],
  };
}

export function composePrintDocument(input: {
  kind: PrintDocumentKind;
  platformBrand: Brand;
  business: BusinessAccount;
  body: readonly PrintLine[];
  code?: PrintDocument["code"];
  paperWidthMm?: PrintDocument["paperWidthMm"];
}): PrintDocument {
  if (input.body.length === 0) throw new PrintError("A printed document needs content");
  const { header, warnings } = printHeader(input.platformBrand, input.business);
  return Object.freeze({
    kind: input.kind,
    header,
    body: input.body,
    ...(input.code ? { code: input.code } : {}),
    paperWidthMm: input.paperWidthMm ?? (input.kind === "INVOICE" || input.kind === "PAYOUT_STATEMENT" ? 210 : 80),
    warnings,
  });
}

/** Printer adapters call this before rendering: a document without both logo slots is refused. */
export function assertPrintable(doc: PrintDocument): void {
  if (doc.header.platformLogo?.type !== "IMAGE" || !doc.header.platformLogo.assetId) throw new PrintError("Missing Tunakula logo");
  const b = doc.header.businessLogo;
  if (!b || (b.type === "IMAGE" && !b.assetId) || (b.type === "TEXT" && !b.text.trim())) throw new PrintError("Missing business logo");
}

/** Port implemented per printer type (thermal, label, PDF). */
export interface PrinterAdapter {
  readonly id: string;
  render(doc: PrintDocument): Promise<Uint8Array>;
}
