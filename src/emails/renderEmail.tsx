import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandLayout, BrandParagraph } from "./BrandLayout";

function toHtml(node: React.ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(node)}`;
}

export function renderOtpEmail(opts: {
  heading: string;
  greetingName: string;
  code: string;
  purpose: string;
}): string {
  return toHtml(
    <BrandLayout preview={opts.heading} heading={opts.heading}>
      <BrandParagraph>Hi {opts.greetingName},</BrandParagraph>
      <BrandParagraph>{opts.purpose}</BrandParagraph>
      <BrandParagraph>
        <strong style={{ fontSize: 22, letterSpacing: "0.18em", color: "#0f172a" }}>
          {opts.code}
        </strong>
      </BrandParagraph>
      <BrandParagraph>It expires in 10 minutes. If you did not request this, you can ignore this email.</BrandParagraph>
    </BrandLayout>,
  );
}

export function renderAbandonedCartEmail(opts: {
  name: string;
  itemCount: number;
  total: string;
  cartUrl: string;
}): string {
  return toHtml(
    <BrandLayout
      preview="Your cart is waiting"
      heading="Complete your order"
      ctaLabel="Return to cart"
      ctaHref={opts.cartUrl}
    >
      <BrandParagraph>Hi {opts.name},</BrandParagraph>
      <BrandParagraph>
        You left <strong>{opts.itemCount}</strong> item{opts.itemCount !== 1 ? "s" : ""} in your cart (
        {opts.total}). They may sell out — checkout takes just a minute.
      </BrandParagraph>
    </BrandLayout>,
  );
}

export function renderOrderConfirmEmail(opts: {
  name: string;
  orderNumber: string;
  total: string;
  orderUrl: string;
}): string {
  return toHtml(
    <BrandLayout
      preview={`Order confirmation ${opts.orderNumber}`}
      heading="Thank you for your order"
      ctaLabel="View order"
      ctaHref={opts.orderUrl}
    >
      <BrandParagraph>Hi {opts.name},</BrandParagraph>
      <BrandParagraph>
        We have received order <strong>{opts.orderNumber}</strong>.
      </BrandParagraph>
      <BrandParagraph>
        Order total: <strong>{opts.total}</strong>
      </BrandParagraph>
    </BrandLayout>,
  );
}
