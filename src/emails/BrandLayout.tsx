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

const frontendUrl = process.env.FRONTEND_URL || "https://thehouseofrani.com";

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
      <Body style={{ backgroundColor: "#f8f5f0", margin: 0, padding: "24px 0", fontFamily: "Georgia, serif" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", backgroundColor: "#ffffff", borderRadius: 16, overflow: "hidden" }}>
          <Section style={{ backgroundColor: "#1a2b48", padding: "20px 28px" }}>
            <Img
              src={`${frontendUrl}/logo.png`}
              alt="The House of Rani"
              width={40}
              height={40}
              style={{ borderRadius: 8 }}
            />
            <Text style={{ color: "#c5a059", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", margin: "10px 0 0" }}>
              The House of Rani
            </Text>
          </Section>
          <Section style={{ padding: "28px 28px 8px" }}>
            <Text style={{ fontSize: 22, color: "#1a2b48", margin: "0 0 12px" }}>{props.heading}</Text>
            {props.children}
            {props.ctaLabel && props.ctaHref ? (
              <Link
                href={props.ctaHref}
                style={{
                  display: "inline-block",
                  marginTop: 16,
                  backgroundColor: "#c5a059",
                  color: "#1a2b48",
                  padding: "12px 20px",
                  borderRadius: 999,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {props.ctaLabel}
              </Link>
            ) : null}
          </Section>
          <Section style={{ padding: "8px 28px 28px" }}>
            <Text style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
              This is an automated message from The House of Rani.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function BrandParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 15, lineHeight: "24px", color: "#334155", margin: "0 0 12px" }}>
      {children}
    </Text>
  );
}
