import { Request, Response } from "express";
import Product from "../models/Product";
import Blog from "../models/Blog";
import catchAsync from "../types/utils/catchAsync";

function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/\[\[image:\d+\]\]/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function getBaseUrl(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://www.thehouseofrani.com";
  return raw.replace(/\/+$/, "");
}

function resolveImageUrl(img: unknown, baseUrl: string): string {
  if (!img) return "";
  let url = "";
  if (typeof img === "string") {
    url = img.trim();
  } else if (typeof img === "object" && img !== null) {
    url = String((img as { url?: string }).url || "").trim();
  }
  if (!url) return "";
  if (url.startsWith("/")) {
    return `${baseUrl}${url}`;
  }
  return url;
}

/**
 * Generates standard Pinterest / Google Merchant Catalog XML feed
 * GET /api/feeds/pinterest-catalog.xml
 */
export const getPinterestCatalogFeed = catchAsync(
  async (_req: Request, res: Response) => {
    const baseUrl = getBaseUrl();
    // Query active products safely (including docs where isActive is undefined/true)
    const products = await Product.find({ isActive: { $ne: false } })
      .sort({ isPremium: -1, createdAt: -1 })
      .lean();

    const itemsXml: string[] = [];

    for (const p of products) {
      // Determine canonical PDP link
      let linkUrl = "";
      if (p.isPremium && p.premiumSlug) {
        linkUrl = `${baseUrl}/premium/${encodeURIComponent(p.premiumSlug)}`;
      } else if (p.slug) {
        linkUrl = `${baseUrl}/shop/${encodeURIComponent(p.slug)}`;
      } else if (p._id) {
        linkUrl = `${baseUrl}/shop/${encodeURIComponent(String(p._id))}`;
      } else {
        continue;
      }

      // Determine main image URL safely
      let mainImageUrl =
        p.isPremium ? resolveImageUrl(p.premiumHeroImage, baseUrl) : "";
      if (!mainImageUrl && Array.isArray(p.images) && p.images.length > 0) {
        mainImageUrl = resolveImageUrl(p.images[0], baseUrl);
      }
      if (!mainImageUrl) {
        mainImageUrl = `${baseUrl}/images/hero-bg.jpg`;
      }

      // Additional images (up to 10)
      const additionalImages = (Array.isArray(p.images) ? p.images : [])
        .map((img) => resolveImageUrl(img, baseUrl))
        .filter((url): url is string => Boolean(url) && url !== mainImageUrl)
        .slice(0, 10);

      const rawTitle = p.name || "Saree Product";
      const titleText =
        p.isPremium && p.premiumSubtitle ?
          `${rawTitle} - ${p.premiumSubtitle}`
        : rawTitle;
      const title = escapeXml(titleText);

      let rawDesc =
        p.shortDescription ||
        p.seoDescription ||
        p.description ||
        p.name ||
        "Handcrafted Luxury Saree";
      if (p.isPremium) {
        const extraBits: string[] = [];
        if (p.craftNote) extraBits.push(`Craft Note: ${p.craftNote}`);
        if (p.weaveHours)
          extraBits.push(`Artisan Weave Time: ${p.weaveHours} Hours`);
        if (extraBits.length > 0) {
          rawDesc = `${extraBits.join(" | ")} - ${rawDesc}`;
        }
      }
      const description = escapeXml(stripHtml(rawDesc).slice(0, 4900));

      const priceVal = Number(p.price || 0);
      const compareVal =
        p.comparePrice && Number(p.comparePrice) > priceVal ?
          Number(p.comparePrice)
        : null;

      const regularPriceXml = `<g:price>${(compareVal || priceVal).toFixed(2)} INR</g:price>`;
      const salePriceXml =
        compareVal ?
          `<g:sale_price>${priceVal.toFixed(2)} INR</g:sale_price>`
        : "";

      const totalStock = Number(p.totalStock || 0);
      const availability = totalStock > 0 ? "in stock" : "out of stock";
      const audienceTag = String(p.audience || "women").toLowerCase();

      // Build hierarchical product_type (e.g. WOMEN > Sarees > Silk Sarees > Pure Silk)
      const typeParts: string[] = [];
      if (p.isPremium) {
        typeParts.push("Premium Edit");
      }
      typeParts.push(audienceTag.toUpperCase());
      if (p.category) typeParts.push(p.category);
      if (p.subcategory) typeParts.push(p.subcategory);
      if (p.fabric) typeParts.push(p.fabric);

      const productType = typeParts.join(" > ");

      const itemId =
        p.variants && p.variants[0]?.sku ?
          String(p.variants[0].sku)
        : String(p._id);

      const customLabel0 = p.isPremium ? "Premium Edit" : "Regular Storefront";
      const customLabel1 =
        p.category ?
          p.subcategory ?
            `${p.category} - ${p.subcategory}`
          : p.category
        : "General";
      const customLabel2 = audienceTag; // women, men, kids, couple
      const customLabel3 =
        p.fabric ? p.fabric
        : p.weaveHours ? `${p.weaveHours} Hrs Weave`
        : totalStock > 0 ? "In Stock"
        : "Out of Stock";
      const customLabel4 = compareVal ? "On Sale" : "Full Price";

      let itemXml = `    <item>
      <g:id>${escapeXml(itemId)}</g:id>
      <g:title>${title}</g:title>
      <g:description>${description}</g:description>
      <g:link>${escapeXml(linkUrl)}</g:link>
      <g:image_link>${escapeXml(mainImageUrl)}</g:image_link>`;

      for (const addImg of additionalImages) {
        itemXml += `\n      <g:additional_image_link>${escapeXml(addImg)}</g:additional_image_link>`;
      }

      itemXml += `
      ${regularPriceXml}`;

      if (salePriceXml) {
        itemXml += `\n      ${salePriceXml}`;
      }

      itemXml += `
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:brand>The House of Rani</g:brand>
      <g:google_product_category>Apparel &amp; Accessories &gt; Clothing</g:google_product_category>
      <g:product_type>${escapeXml(productType)}</g:product_type>
      <g:item_group_id>${escapeXml(String(p._id))}</g:item_group_id>
      <g:custom_label_0>${escapeXml(customLabel0)}</g:custom_label_0>
      <g:custom_label_1>${escapeXml(customLabel1)}</g:custom_label_1>
      <g:custom_label_2>${escapeXml(customLabel2)}</g:custom_label_2>
      <g:custom_label_3>${escapeXml(customLabel3)}</g:custom_label_3>
      <g:custom_label_4>${escapeXml(customLabel4)}</g:custom_label_4>
    </item>`;

      itemsXml.push(itemXml);
    }

    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>The House of Rani - Pinterest Product Catalog</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Official product catalog feed for Pinterest Shopping and Auto Pinning</description>
${itemsXml.join("\n")}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.status(200).send(xmlPayload);
  },
);

/**
 * Generates RSS 2.0 XML feed for Blog posts for Pinterest RSS Auto-Pinning
 * GET /api/feeds/blog-rss.xml
 */
export const getBlogRssFeed = catchAsync(
  async (_req: Request, res: Response) => {
    const baseUrl = getBaseUrl();
    const blogs = await Blog.find({ isPublished: { $ne: false } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const itemsXml: string[] = [];

    for (const b of blogs) {
      const blogUrl =
        b.slug ?
          `${baseUrl}/blog/${encodeURIComponent(b.slug)}`
        : `${baseUrl}/blog/${b._id}`;
      const title = escapeXml(b.title || "Journal Story");

      const plainContent = stripHtml(b.content || "");
      const rawExcerpt =
        b.excerpt || b.seoDescription || plainContent || b.title;
      const description = escapeXml(stripHtml(rawExcerpt).slice(0, 500));

      const pubDate = new Date(b.createdAt || Date.now()).toUTCString();

      // Determine main cover image safely
      let coverImg = "";
      if (Array.isArray(b.images) && b.images.length > 0) {
        const coverObj =
          b.images.find((img: any) => img?.placement === "cover") ||
          b.images[0];
        coverImg = resolveImageUrl(coverObj, baseUrl);
      }
      if (!coverImg) {
        coverImg = `${baseUrl}/images/hero-bg.jpg`;
      }

      // Transform internal [[image:N]] placeholders into real HTML <img> tags or clean them up
      let formattedContent = (b.content || "").replace(
        /\[\[image:(\d+)\]\]/gi,
        (_match, indexStr) => {
          const idx = parseInt(indexStr, 10);
          const imgObj = Array.isArray(b.images) && b.images[idx];
          const imgUrl = resolveImageUrl(imgObj, baseUrl);
          if (imgUrl) {
            const captionText =
              imgObj && typeof imgObj === "object" && (imgObj as any).caption ?
                escapeXml((imgObj as any).caption)
              : "";
            return `<figure><img src="${escapeXml(imgUrl)}" alt="${captionText || title}" />${captionText ? `<figcaption>${captionText}</figcaption>` : ""}</figure>`;
          }
          return "";
        },
      );

      const mediaXml = `
      <media:content url="${escapeXml(coverImg)}" medium="image" />
      <enclosure url="${escapeXml(coverImg)}" type="image/jpeg" length="0" />`;

      const category = escapeXml(b.category || "saree-styling");

      const itemXml = `    <item>
      <title>${title}</title>
      <link>${escapeXml(blogUrl)}</link>
      <guid isPermaLink="true">${escapeXml(blogUrl)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      <content:encoded><![CDATA[${formattedContent}]]></content:encoded>${mediaXml}
      <dc:creator>The House of Rani</dc:creator>
      <category>${category}</category>
    </item>`;

      itemsXml.push(itemXml);
    }

    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The House of Rani - Journal &amp; Stories</title>
    <link>${escapeXml(baseUrl)}/blog</link>
    <description>Discover ethnic wear styling guides, heritage saree stories, and fashion insights from The House of Rani.</description>
    <language>en-in</language>
    <atom:link href="${escapeXml(baseUrl)}/feeds/blog-rss.xml" rel="self" type="application/rss+xml" />
${itemsXml.join("\n")}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.status(200).send(xmlPayload);
  },
);

/**
 * Generates RSS 2.0 XML feed for New Products & Premium Collection items for Pinterest Auto-Pinning
 * GET /api/feeds/products-rss.xml
 */
export const getProductsRssFeed = catchAsync(
  async (_req: Request, res: Response) => {
    const baseUrl = getBaseUrl();
    const products = await Product.find({ isActive: { $ne: false } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const itemsXml: string[] = [];

    for (const p of products) {
      let linkUrl = "";
      if (p.isPremium && p.premiumSlug) {
        linkUrl = `${baseUrl}/premium/${encodeURIComponent(p.premiumSlug)}`;
      } else if (p.slug) {
        linkUrl = `${baseUrl}/shop/${encodeURIComponent(p.slug)}`;
      } else if (p._id) {
        linkUrl = `${baseUrl}/shop/${encodeURIComponent(String(p._id))}`;
      } else {
        continue;
      }

      let mainImageUrl =
        p.isPremium ? resolveImageUrl(p.premiumHeroImage, baseUrl) : "";
      if (!mainImageUrl && Array.isArray(p.images) && p.images.length > 0) {
        mainImageUrl = resolveImageUrl(p.images[0], baseUrl);
      }
      if (!mainImageUrl) {
        mainImageUrl = `${baseUrl}/images/hero-bg.jpg`;
      }

      const rawTitle = p.name || "Saree Product";
      const titleText =
        p.isPremium && p.premiumSubtitle ?
          `${rawTitle} - ${p.premiumSubtitle}`
        : rawTitle;
      const title = escapeXml(titleText);

      let rawDesc =
        p.shortDescription ||
        p.seoDescription ||
        p.description ||
        p.name ||
        "Handcrafted Luxury Saree";
      if (p.isPremium) {
        const extraBits: string[] = [];
        if (p.craftNote) extraBits.push(`Craft Note: ${p.craftNote}`);
        if (p.weaveHours) extraBits.push(`Hand Weave: ${p.weaveHours} Hours`);
        if (extraBits.length > 0) {
          rawDesc = `${extraBits.join(" | ")}. ${rawDesc}`;
        }
      }

      const priceVal = Number(p.price || 0);
      const formattedPrice = `₹${priceVal.toLocaleString("en-IN")} INR`;
      const description = escapeXml(
        `${stripHtml(rawDesc).slice(0, 400)} - Price: ${formattedPrice}`,
      );

      const pubDate = new Date(p.createdAt || Date.now()).toUTCString();
      const audienceTag = String(p.audience || "women").toLowerCase();

      const catParts: string[] = [];
      if (p.isPremium) catParts.push("Premium Edit");
      if (p.category) catParts.push(p.category);
      if (p.subcategory) catParts.push(p.subcategory);
      if (p.fabric) catParts.push(p.fabric);
      catParts.push(`Audience: ${audienceTag}`);
      const category = escapeXml(catParts.join(" | "));

      const itemXml = `    <item>
      <title>${title}</title>
      <link>${escapeXml(linkUrl)}</link>
      <guid isPermaLink="true">${escapeXml(linkUrl)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      <content:encoded><![CDATA[<h3>${escapeXml(titleText)}</h3><p>${escapeXml(stripHtml(rawDesc))}</p><p><strong>Price:</strong> ${formattedPrice}</p>]]></content:encoded>
      <media:content url="${escapeXml(mainImageUrl)}" medium="image" />
      <enclosure url="${escapeXml(mainImageUrl)}" type="image/jpeg" length="0" />
      <dc:creator>The House of Rani</dc:creator>
      <category>${category}</category>
    </item>`;

      itemsXml.push(itemXml);
    }

    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The House of Rani - New Products &amp; Premium Arrivals</title>
    <link>${escapeXml(baseUrl)}/shop/collections</link>
    <description>Latest ethnic wear launches, hand painted sarees, pure silk collections, and new arrivals from The House of Rani.</description>
    <language>en-in</language>
    <atom:link href="${escapeXml(baseUrl)}/feeds/products-rss.xml" rel="self" type="application/rss+xml" />
${itemsXml.join("\n")}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.status(200).send(xmlPayload);
  },
);
