import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { BRAND_NAME, BRAND_TAGLINE } from "../constants/brand";

const frontendUrl = process.env.FRONTEND_URL || "https://thehouseofrani.com";
const brandLogoUrl = `${frontendUrl}/logo.png`;

const emailLogoStyle: React.CSSProperties = {
  display: "block",
  border: 0,
  maxWidth: 168,
  width: "auto",
  height: "auto",
  maxHeight: 44,
};

export function BrandEmailHeader() {
  return (
    <Section style={{ backgroundColor: "#1a2b48", padding: "22px 28px" }}>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td style={{ verticalAlign: "middle" }}>
              <Img
                src={brandLogoUrl}
                alt={BRAND_NAME}
                width={168}
                style={emailLogoStyle}
              />
            </td>
            <td
              style={{
                verticalAlign: "middle",
                textAlign: "right",
                paddingLeft: 16,
              }}
            >
              <Text
                style={{
                  color: "rgba(255,255,255,0.88)",
                  fontSize: 13,
                  fontStyle: "italic",
                  lineHeight: "20px",
                  margin: 0,
                  fontFamily: "Georgia, 'Times New Roman', serif",
                }}
              >
                {BRAND_TAGLINE}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function BrandLayout(props: {
  preview: string;
  heading: string;
  children: React.ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body
        style={{
          backgroundColor: "#f8f5f0",
          margin: 0,
          padding: "24px 0",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: "0 auto",
            backgroundColor: "#ffffff",
            borderRadius: 16,
            overflow: "hidden",
            border: "1px solid #e8e4dc",
          }}
        >
          <BrandEmailHeader />
          <Section style={{ padding: "28px 28px 8px" }}>
            <Text
              style={{
                fontSize: 22,
                color: "#1a2b48",
                margin: "0 0 12px",
                fontWeight: 600,
                lineHeight: "1.35",
              }}
            >
              {props.heading}
            </Text>
            {props.children}
            {props.ctaLabel && props.ctaHref ?
              <Link
                href={props.ctaHref}
                style={{
                  display: "inline-block",
                  marginTop: 16,
                  backgroundColor: "#c5a059",
                  color: "#1a2b48",
                  padding: "12px 22px",
                  borderRadius: 999,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {props.ctaLabel}
              </Link>
            : null}
          </Section>
          <Section
            style={{
              padding: "16px 28px 28px",
              borderTop: "1px solid #f0ebe3",
              backgroundColor: "#faf8f5",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontStyle: "italic",
                color: "#6b7280",
                margin: "0 0 8px",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              {BRAND_TAGLINE}
            </Text>
            <Text style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>
              Automated message from {BRAND_NAME}. Need help? Reply or contact us
              on the website.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function BrandParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 15,
        lineHeight: "24px",
        color: "#334155",
        margin: "0 0 12px",
        fontFamily: "Inter, Segoe UI, Arial, sans-serif",
      }}
    >
      {children}
    </Text>
  );
}
